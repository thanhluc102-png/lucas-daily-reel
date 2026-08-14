#!/usr/bin/env node
/**
 * Script tự động sinh bài viết SEO dạng "Top Listicle" (Top 5, Top 7...) cho các danh mục sản phẩm của Lucas.vn
 * 
 * Sử dụng:
 *   node scripts/gen-top-listicle-seo.mjs --category tau-sac-o-to --dry-run
 *   node scripts/gen-top-listicle-seo.mjs --category tau-sac-o-to --status publish
 *   node scripts/gen-top-listicle-seo.mjs --all --status draft
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// Credentials & Cấu hình
const STORE_URL = process.env.WP_SITE_URL || 'https://lucas.vn';
const CK = process.env.WC_CONSUMER_KEY;
const CS = process.env.WC_CONSUMER_SECRET;
const WP_USER = process.env.WP_USERNAME || 'luucat';
const WP_PASS = process.env.WP_APP_PASSWORD || 'FVLL lVs8 c21w 8RO5 kbzf OYk4';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';

// Parse CLI Args
const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const targetSlug = getArg('--category');
const isAll = args.includes('--all');
const isAutoDaily = args.includes('--auto-daily');
const isDryRun = args.includes('--dry-run');
const postStatus = getArg('--status') || 'draft'; // 'draft' hoặc 'publish'
const limitArg = getArg('--limit');
const maxCatsToProcess = limitArg ? parseInt(limitArg, 10) : (isAll ? 999 : 1);

// Từ cấm thương hiệu & Luật Quảng cáo Việt Nam (Cấm dùng từ "nhất", "tốt nhất", "số 1"...)
const FORBIDDEN_WORDS = [
  /cực kỳ/gi, /siêu phẩm/gi, /đỉnh cao/gi, /must-have/gi, /must have/gi, /xịn xò/gi, /chất lượng tuyệt vời/gi,
  /tốt nhất/gi, /\bnhất\b/gi, /số 1\b/gi, /số một\b/gi, /duy nhất\b/gi, /hàng đầu\b/gi
];

function stripHtml(s = '') {
  return s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function formatVnd(amount) {
  if (!amount) return '';
  const num = Number(amount);
  return num.toLocaleString('vi-VN').replace(/,/g, '.') + 'đ';
}

function getAuthHeaders() {
  const token = Buffer.from(`${CK}:${CS}`).toString('base64');
  return { 'Authorization': `Basic ${token}` };
}

function getWpAuthHeaders() {
  const token = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');
  return { 'Authorization': `Basic ${token}` };
}

// 1. Kéo danh mục sản phẩm từ WooCommerce (sử dụng Store API công khai + fallback REST v3)
async function fetchCategories() {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  let res = await fetch(`${STORE_URL}/wp-json/wc/store/v1/products/categories?per_page=100`, {
    headers: { 'User-Agent': ua }
  });
  if (!res.ok) {
    res = await fetch(`${STORE_URL}/wp-json/wc/v3/products/categories?per_page=100`, {
      headers: { ...getAuthHeaders(), 'User-Agent': ua }
    });
  }
  if (!res.ok) throw new Error(`Lỗi fetch categories: ${res.status}`);
  const categories = await res.json();
  return categories.filter(c => c.count >= 2);
}

// 2. Kéo danh sách sản phẩm thuộc 1 danh mục
async function fetchProductsForCategory(catId) {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
  let res = await fetch(`${STORE_URL}/wp-json/wc/store/v1/products?category=${catId}&per_page=15&orderby=popularity`, {
    headers: { 'User-Agent': ua }
  });
  if (!res.ok) {
    res = await fetch(`${STORE_URL}/wp-json/wc/v3/products?category=${catId}&status=publish&per_page=15&orderby=popularity`, {
      headers: { ...getAuthHeaders(), 'User-Agent': ua }
    });
  }
  if (!res.ok) throw new Error(`Lỗi fetch products cho cat ${catId}: ${res.status}`);
  const products = await res.json();
  return products.map(p => {
    let priceNum = p.price;
    let regularNum = p.regular_price;
    let isOnSale = !!p.on_sale;

    if (p.prices) {
      const minorUnit = p.prices.currency_minor_unit !== undefined ? Number(p.prices.currency_minor_unit) : 0;
      const div = 10 ** minorUnit;
      priceNum = Math.round(Number(p.prices.price) / div);
      regularNum = p.prices.regular_price ? Math.round(Number(p.prices.regular_price) / div) : null;
      if (p.prices.on_sale !== undefined) isOnSale = !!p.prices.on_sale;
    }

    const priceStr = formatVnd(priceNum);
    const regularStr = regularNum && regularNum > priceNum ? formatVnd(regularNum) : '';
    const desc = stripHtml(p.short_description || p.description || p.summary || '').slice(0, 300);

    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      priceStr,
      regularStr,
      onSale: isOnSale,
      url: p.permalink,
      image: p.images?.[0]?.src || '',
      desc
    };
  }).filter(p => p.image);
}

// Helper: Thiết kế & Upload Thumbnail 1200x630 chuẩn SEO có chữ & thương hiệu
async function uploadFeaturedImage(imageUrl, title, categoryName = '') {
  if (!imageUrl) return null;
  console.log(`🖼️  Đang thiết kế Thumbnail 1200x630 chuẩn SEO có chữ & logo thương hiệu...`);
  try {
    const tmpThumbPath = path.join(root, 'build', `thumb-${Date.now()}.jpg`);
    fs.mkdirSync(path.dirname(tmpThumbPath), { recursive: true });

    const kicker = categoryName ? `PHỤ KIỆN ${categoryName.toUpperCase()}` : 'PHỤ KIỆN LUCAS.VN';

    // Gọi scripts/make_thumb.py bằng Python3 để vẽ ảnh
    execFileSync('python3', [
      path.join(root, 'scripts', 'make_thumb.py'),
      imageUrl,
      title,
      tmpThumbPath,
      kicker
    ], { stdio: 'inherit' });

    if (!fs.existsSync(tmpThumbPath)) return null;

    const buffer = fs.readFileSync(tmpThumbPath);
    const filename = `seo-thumb-${Date.now()}.jpg`;

    const uploadRes = await fetch(`${STORE_URL}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        ...getWpAuthHeaders(),
        'Content-Type': 'image/jpeg',
        'Content-Disposition': `attachment; filename="${filename}"`
      },
      body: buffer
    });

    // Xóa file tạm
    try { fs.rmSync(tmpThumbPath, { force: true }); } catch {}

    if (uploadRes.ok) {
      const media = await uploadRes.json();
      console.log(`✅ Đã thiết kế & tải lên Featured Image (Media ID: ${media.id})`);
      return media.id;
    } else {
      console.warn(`⚠️ Lỗi upload ảnh lên WordPress: ${uploadRes.status}`);
    }
  } catch (e) {
    console.warn(`⚠️ Lỗi thiết kế Featured Image: ${e.message}`);
  }
  return null;
}

// 3. Hỏi Claude viết bài Top Listicle SEO
async function generateListicleWithClaude(categoryName, products, angle = 'Đáng Mua') {
  // Giới hạn Top 5 - 6 sản phẩm tốt nhất để bài viết súc tích, vừa đủ độ dài và KHÔNG bị tràn token ngắt lời
  const topCount = Math.min(products.length, 6);
  const selectedProducts = products.slice(0, topCount);
  const currentYear = new Date().getFullYear();

  const prompt = `Bạn là chuyên gia viết bài blog chuẩn SEO cho Lucas Combo (lucas.vn) - shop phụ kiện Apple & công nghệ chính hãng tại TP.HCM.
Giọng thương hiệu: Thẳng thắn, am hiểu kỹ thuật, trung thực, không nói quá, không nổ.
TỪ CẤM NGHÊM NGẶT THEO LUẬT QUẢNG CÁO VIỆT NAM (TUYỆT ĐỐI KHÔNG DÙNG): "tốt nhất", "nhất", "số 1", "số một", "duy nhất", "hàng đầu", "cực kỳ", "siêu phẩm", "đỉnh cao", "xịn xò".
TẤT CẢ TIÊU ĐỀ VÀ NỘI DUNG TUYỆT ĐỐI KHÔNG CHỨA TỪ "TỐT NHẤT" HAY CHỮ "NHẤT". Dùng từ hợp lệ thay thế như: "${angle}", "Nổi Bật", "Bán Chạy", "Được Tin Dùng", "Cao Cấp".

NHIỆM VỤ: Viết bài tổng hợp SEO dạng Top Listicle cho danh mục: "${categoryName}" theo góc nhìn: "${angle}".

DANH SÁCH ${topCount} SẢN PHẨM THẬT (dùng thông tin này, KHÔNG bịa giá hay tên sản phẩm):
${selectedProducts.map((p, i) => `
${i + 1}. Tên: ${p.name}
   - Giá: ${p.priceStr} ${p.onSale ? `(Giá gốc: ${p.regularStr})` : ''}
   - Ảnh: ${p.image}
   - Link mua: ${p.url}
   - Mô tả sơ bộ: ${p.desc}
`).join('\n')}

YÊU CẦU ĐỊNH DẠNG VÀ CẤU TRÚC BÀI VIẾT:
1. SEO Title: Bắt đầu bằng "Top ${topCount} [Tên/Từ khóa phù hợp ${categoryName}] ${angle} ${currentYear} | Lucas Combo" (Dưới 60 ký tự, KHÔNG chứa từ "nhất").
2. Focus Keyword: Chọn từ khóa SEO tự nhiên cho danh mục (vd: "Tẩu sạc ô tô", "Túi chống sốc MacBook").
3. Meta Description: 125 - 155 ký tự, chứa Focus Keyword và kêu gọi xem bài viết (KHÔNG chứa từ "nhất").
4. Nội dung bài viết (Format HTML chuẩn):
   - Mở đầu bằng <h2>: Nhu cầu chọn mua ${categoryName} chuẩn, những tiêu chí quan trọng.
   - <h2>Đánh Giá Chi Tiết Top ${topCount} ${categoryName} ${angle} ${currentYear}</h2>
   - Với mỗi sản phẩm (1 đến ${topCount}):
     + Dùng <h3>: Tên sản phẩm (BẮT BUỘC KHÔNG THÊM số thứ tự 1., 2., 3. ở đầu thẻ h3 vì plugin Mục Lục của WordPress đã tự động đánh số 2.1, 2.2...)
     + Chèn thẻ <img> CĂN GIỮA NẰM TRONG KHỐI DIV (bắt buộc căn giữa):
       <div style="text-align: center; margin: 20px 0;"><img src="[URL_ANH]" alt="[Ten_SP]" width="600" style="max-width: 100%; height: auto; border-radius: 12px; display: block; margin: 0 auto; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" /></div>
     + Thẻ <p><strong>Giá tham khảo:</strong> [Giá sản phẩm]</p>
     + Đoạn văn đánh giá thực tế tính năng (ngắn gọn 60-80 từ, súc tích).
     + Đoạn <ul> với 2-3 Ưu điểm & 1-2 Nhược điểm rõ ràng.
     + Thẻ <a> nút đặt mua CĂN GIỮA dẫn về link sản phẩm trên lucas.vn:
       <div style="text-align: center; margin: 16px 0 28px 0;"><a href="[URL_SP]" style="background: #0B1B2E; color: #C9A227; padding: 12px 24px; border-radius: 8px; display: inline-block; text-decoration: none; font-weight: bold; font-size: 15px;">Xem Chi Tiết & Đặt Mua Tại Lucas.vn</a></div>
   - <h2>Kinh Nghiệm Chọn Mua ${categoryName} Phù Hợp</h2>
   - <h2>Tổng Kết & Đặt Hàng Tại Lucas Combo</h2> (BẮT BUỘC viết đầy đủ 2 đoạn văn kết bài hoàn chỉnh: khẳng định uy tín Lucas Combo chính hãng, bảo hành 1 đổi 1, giao hàng toàn quốc, KHÔNG được cắt dở dang chừng).

VUI LÒNG TRẢ VỀ ĐÚNG CÁC THẺ SAU ĐỂ HỆ THỐNG TRÍCH XUẤT (KHÔNG THÊM BẤT KỲ VĂN BẢN NGOÀI CÁC THẺ NÀY):
<seo_title>Viết tiêu đề SEO tại đây</seo_title>
<focus_keyword>Viết từ khóa tại đây</focus_keyword>
<meta_description>Viết meta description tại đây</meta_description>
<content_html>
Viết toàn bộ nội dung HTML tại đây
</content_html>`;

  const body = {
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }]
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API Error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const jsonRes = await response.json();
  if (jsonRes.stop_reason === 'max_tokens') {
    throw new Error('Cảnh báo: Phản hồi từ Claude bị cắt do vượt giới hạn max_tokens');
  }

  const rawText = jsonRes.content?.find(b => b.type === 'text')?.text || '';
  
  const getTagContent = (tag) => {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
    const match = rawText.match(regex);
    return match ? match[1].trim() : '';
  };

  const seoTitle = getTagContent('seo_title') || `Top ${topCount} ${categoryName} Tốt Nhất ${currentYear} | Lucas Combo`;
  const focusKeyword = getTagContent('focus_keyword') || categoryName;
  const metaDesc = getTagContent('meta_description') || `Mua ${categoryName} chính hãng tại Lucas Combo.`;
  
  let contentHtml = getTagContent('content_html');
  if (!contentHtml) {
    const fallbackMatch = rawText.match(/<content_html>([\s\S]*)/i);
    contentHtml = fallbackMatch ? fallbackMatch[1].replace(/<\/content_html>[\s\S]*/i, '').trim() : rawText;
  }

  let data = {
    seo_title: seoTitle,
    focus_keyword: focusKeyword,
    meta_description: metaDesc,
    content_html: contentHtml
  };

  // Làm sạch các từ cấm nếu còn sót (Luật Quảng cáo VN & thương hiệu)
  FORBIDDEN_WORDS.forEach(regex => {
    data.seo_title = data.seo_title.replace(regex, 'Cao Cấp');
    data.meta_description = data.meta_description.replace(regex, 'chất lượng');
    data.content_html = data.content_html.replace(regex, 'chất lượng cao');
  });

  // Tăng cường SEO & Tỷ lệ chuyển đổi mua hàng
  data.content_html = enrichHtmlWithSeoFeatures(data.content_html, categoryName, selectedProducts, focusKeyword);

  return data;
}

// Helper: Tăng cường SEO (Voucher Banner, Internal Links, Image Lazy Loading)
function enrichHtmlWithSeoFeatures(html, categoryName, selectedProducts, focusKeyword) {
  let enriched = html;

  // 1. Tối ưu ảnh & Mục Lục: Thêm loading="lazy" và xóa số dư ở đầu thẻ <h3>
  enriched = enriched.replace(/<img\s+/gi, '<img loading="lazy" ');
  enriched = enriched.replace(/<h3([^>]*)>\s*\d+[\.\)]\s*/gi, '<h3$1>');

  // 2. Khung Voucher LUCAS50K thúc đẩy chuyển đổi mua hàng
  const voucherBanner = `
<div style="background: linear-gradient(135deg, #0B1B2E 0%, #152A45 100%); color: #FFFFFF; padding: 24px; border-radius: 16px; margin: 36px 0; border: 2px solid #C9A227; text-align: center; box-shadow: 0 8px 24px rgba(11,27,46,0.15);">
  <div style="color: #C9A227; margin: 0 0 10px 0; font-size: 20px; font-weight: 800; text-transform: uppercase;">🎁 ƯU ĐÃI ĐẶC BIỆT DÀNH CHO BẠN ĐỌC BLOG LUCAS COMBO</div>
  <p style="margin: 0 0 16px 0; font-size: 15px; color: #E2E8F0; line-height: 1.6;">Nhập mã <strong style="background: #C9A227; color: #0B1B2E; padding: 4px 10px; border-radius: 6px; font-size: 16px; font-weight: 800;">LUCAS50K</strong> khi thanh toán tại lucas.vn để được <strong>Giảm Ngay 50.000đ</strong> cho đơn hàng phụ kiện trên 500k!</p>
  <a href="https://lucas.vn" style="background: #C9A227; color: #0B1B2E; padding: 12px 28px; border-radius: 8px; font-weight: bold; text-decoration: none; display: inline-block; font-size: 15px;">Khám Phá Phụ Kiện Chính Hãng Ngay ›</a>
</div>`;

  // 3. Khung Gợi Ý Xem Thêm (Internal Linking Matrix)
  const internalLinkBox = `
<div style="background: #F8FAFC; border-left: 4px solid #0B1B2E; padding: 18px 20px; border-radius: 8px; margin: 30px 0;">
  <div style="margin: 0 0 10px 0; color: #0B1B2E; font-size: 16px; font-weight: 700;">📌 Gợi Ý Xem Thêm Tại Lucas Combo:</div>
  <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
    <li><a href="https://lucas.vn/danh-muc/tui-chong-soc-macbook" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Xem toàn bộ Phụ Kiện Túi Chống Sốc & Balo MacBook Chính Hãng</a></li>
    <li><a href="https://lucas.vn/danh-muc/dan-macbook" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Bộ Dán Màn Hình & Vỏ Máy Bảo Vệ Apple</a></li>
    <li><a href="https://lucas.vn/danh-muc/hub-chuyen-doi" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Hub Chuyển Đổi Type-C Đa Năng Cho iPad & Laptop</a></li>
  </ul>
</div>`;

  return enriched + voucherBanner + internalLinkBox;
}

// Helper: Tự động chia sẻ bài viết lên Facebook Fanpage Lucas Combo
async function shareToFacebook(postLink, postTitle, metaDesc) {
  const fbToken = process.env.FB_PAGE_TOKEN;
  const fbPageId = process.env.FB_PAGE_ID || '1485664424846467'; // Default ID if not passed
  if (!fbToken) {
    console.log('ℹ️  Chưa cấu hình FB_PAGE_TOKEN, bỏ qua chia sẻ Facebook (sẽ tự động chạy trên GitHub Actions).');
    return;
  }

  console.log(`\n📲 Đang tự động chia sẻ bài viết lên Facebook Fanpage Lucas Combo...`);
  try {
    const message = `📌 ${postTitle}\n\n${metaDesc}\n\n👉 Xem bài viết đầy đủ & đặt mua tại: ${postLink}\n\n#LucasCombo #TopListicle #PhuKienApple #LucasVn`;

    const res = await fetch(`https://graph.facebook.com/v25.0/${fbPageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        link: postLink,
        access_token: fbToken
      })
    });

    if (res.ok) {
      const fbData = await res.json();
      console.log(`✅ ĐÃ CHIA SẺ LÊN FACEBOOK FANPAGE THÀNH CÔNG! (FB Post ID: ${fbData.id})`);
    } else {
      const err = await res.text();
      console.warn(`⚠️ Lỗi chia sẻ Facebook Fanpage: ${res.status} - ${err.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`⚠️ Lỗi chia sẻ Facebook: ${e.message}`);
  }
}

// Helper: Tự động tìm/tạo WordPress Post Tags theo danh mục & thương hiệu sản phẩm
async function getOrCreateTag(name) {
  if (!name || name.trim().length < 2) return null;
  const cleanName = name.trim();
  try {
    const searchRes = await fetch(`${STORE_URL}/wp-json/wp/v2/tags?search=${encodeURIComponent(cleanName)}`, {
      headers: getWpAuthHeaders()
    });
    if (searchRes.ok) {
      const tags = await searchRes.json();
      const exact = Array.isArray(tags) ? tags.find(t => t.name.toLowerCase() === cleanName.toLowerCase()) : null;
      if (exact) return exact.id;
    }

    const createRes = await fetch(`${STORE_URL}/wp-json/wp/v2/tags`, {
      method: 'POST',
      headers: {
        ...getWpAuthHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: cleanName })
    });
    if (createRes.ok) {
      const created = await createRes.json();
      return created.id;
    }
  } catch (e) {
    console.warn(`⚠️ Lỗi lấy/tạo tag "${cleanName}": ${e.message}`);
  }
  return null;
}

async function extractAndResolveTags(categoryName, products = []) {
  const KNOWN_BRANDS = ['Anker', 'LISEN', 'WiWU', 'Tomtoc', 'HyperWork', 'UNIQ', 'Satechi', 'AULUMU', 'Ulanzi', 'Innostyle', 'JCPAL', 'Apple'];
  const tagNamesSet = new Set(['Lucas Combo', 'Phụ Kiện Apple']);

  if (categoryName) {
    tagNamesSet.add(categoryName);
  }

  // Quét thương hiệu có trong tên sản phẩm
  products.forEach(p => {
    KNOWN_BRANDS.forEach(brand => {
      if (p.name && new RegExp(`\\b${brand}\\b`, 'i').test(p.name)) {
        tagNamesSet.add(brand);
      }
    });
  });

  const tagNames = Array.from(tagNamesSet);
  console.log(`🏷️  Tự động phân tích & gắn thẻ/tags: ${tagNames.join(', ')}`);
  const tagIds = (await Promise.all(tagNames.map(getOrCreateTag))).filter(Boolean);
  return tagIds;
}

async function findExistingPost(categorySlug, categoryName = '') {
  try {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
    const res = await fetch(`${STORE_URL}/wp-json/wp/v2/posts?search=${encodeURIComponent(categorySlug)}&per_page=5`, {
      headers: { ...getWpAuthHeaders(), 'User-Agent': ua }
    });
    if (!res.ok) return null;
    const posts = await res.json();
    if (!Array.isArray(posts) || !posts.length) return null;

    const match = posts.find(p => 
      (p.slug && p.slug.includes(categorySlug)) || 
      (p.title?.rendered && p.title.rendered.toLowerCase().includes(categoryName.toLowerCase()))
    );
    return match ? match.id : null;
  } catch (e) {
    return null;
  }
}

// 4. Đăng hoặc cập nhật bài viết lên WordPress REST API
async function publishToWordPress(articleData, categoryObj, featureImageSrc, products = []) {
  const featuredMediaId = await uploadFeaturedImage(featureImageSrc, articleData.seo_title, categoryObj?.name);
  const tagIds = await extractAndResolveTags(categoryObj?.name, products);

  const existingPostId = await findExistingPost(categoryObj?.slug, categoryObj?.name);

  if (existingPostId) {
    console.log(`\n🔄 Phát hiện bài viết cũ ID ${existingPostId} cho danh mục "${categoryObj?.name}". Đang CẬP NHẬT TRỰC TIẾP bài viết này...`);
  } else {
    console.log(`\n📤 Đang tạo bài viết MỚI trên WordPress (${STORE_URL})...`);
  }

  const wpPostData = {
    title: articleData.seo_title,
    content: articleData.content_html,
    status: postStatus, // 'publish' hoặc 'draft'
    ...(tagIds.length ? { tags: tagIds } : {}),
    ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
    meta: {
      _yoast_wpseo_title: articleData.seo_title,
      _yoast_wpseo_metadesc: articleData.meta_description,
      _yoast_wpseo_focuskw: articleData.focus_keyword
    }
  };

  const endpoint = existingPostId ? `${STORE_URL}/wp-json/wp/v2/posts/${existingPostId}` : `${STORE_URL}/wp-json/wp/v2/posts`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...getWpAuthHeaders(),
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
    },
    body: JSON.stringify(wpPostData)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WordPress Post API Error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const updatedPost = await res.json();

  // Chỉ tự động chia sẻ lên Facebook nếu là bài viết mới hoặc được yêu cầu
  if (postStatus === 'publish' && !existingPostId) {
    await shareToFacebook(updatedPost.link, articleData.seo_title, articleData.meta_description);
  }

  return updatedPost;
}

// MAIN FUNCTION
async function main() {
  console.log('===============================================================');
  console.log('🚀 SẢN XUẤT BÀI VIẾT SEO TOP LISTICLE CHO DANH MỤC LUCAS.VN');
  console.log('===============================================================\n');

  const categories = await fetchCategories();
  console.log(`📋 Đã tìm thấy ${categories.length} danh mục có sản phẩm.`);

  const ANGLES = ['Đáng Mua', 'Được Tin Dùng', 'Nổi Bật', 'Bán Chạy', 'Cao Cấp & Uy Tín', 'Đáng Sở Hữu'];
  let currentCycle = 0;
  let targetCategories = categories;
  const stateFilePath = path.join(root, 'seo_top_category_index.json');

  if (isAutoDaily) {
    let lastIndex = -1;
    try {
      if (fs.existsSync(stateFilePath)) {
        const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
        lastIndex = typeof state.last_index === 'number' ? state.last_index : -1;
      }
    } catch { /* fallback to -1 */ }

    const rawNext = lastIndex + 1;
    const nextIndex = rawNext % categories.length;
    currentCycle = Math.floor(rawNext / categories.length);
    targetCategories = [categories[nextIndex]];
    console.log(`🔄 [TỰ ĐỘNG HẰNG NGÀY] Chọn danh mục #${nextIndex + 1}/${categories.length} (Vòng lặp xoay vòng #${currentCycle + 1}): "${categories[nextIndex].name}"`);
    
    // Lưu lại index mới
    fs.writeFileSync(stateFilePath, JSON.stringify({ last_index: rawNext, last_updated: new Date().toISOString() }, null, 2));
  } else if (targetSlug) {
    targetCategories = categories.filter(c => c.slug === targetSlug);
    if (!targetCategories.length) {
      console.error(`❌ Không tìm thấy danh mục có slug: "${targetSlug}"`);
      process.exit(1);
    }
  }

  targetCategories = targetCategories.slice(0, maxCatsToProcess);

  for (const cat of targetCategories) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(`📂 Đang xử lý danh mục: "${cat.name}" (Slug: ${cat.slug})`);
    console.log(`---------------------------------------------------------------`);

    let products = await fetchProductsForCategory(cat.id);
    if (products.length < 2) {
      console.warn(`⚠️ Danh mục "${cat.name}" chỉ có ${products.length} sản phẩm, bỏ qua (cần ít nhất 2).`);
      continue;
    }

    if (currentCycle > 0) {
      // Trộn thứ tự sản phẩm cho các vòng lặp xoay vòng sau
      products = products.sort(() => Math.random() - 0.5);
    }

    const selectedAngle = ANGLES[currentCycle % ANGLES.length];
    console.log(`🔍 Tìm thấy ${products.length} sản phẩm. Đang tạo bài Top ${Math.min(products.length, 6)} (Góc nhìn: "${selectedAngle}")...`);

    const article = await generateListicleWithClaude(cat.name, products, selectedAngle);

    console.log(`\n✨ KẾT QUẢ SÁNG TẠO:`);
    console.log(`📌 SEO Title        : ${article.seo_title}`);
    console.log(`🔑 Focus Keyword    : ${article.focus_keyword}`);
    console.log(`📝 Meta Description : ${article.meta_description}`);
    console.log(`📄 Độ dài HTML      : ${article.content_html.length} ký tự`);

    if (isDryRun) {
      console.log(`\n🔍 Chế độ DRY RUN: Không đăng lên WordPress.`);
      const outDir = path.join(root, 'build');
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `top-listicle-${cat.slug}.json`);
      fs.writeFileSync(outFile, JSON.stringify(article, null, 2));
      console.log(`💾 Đã lưu bản xem trước tại: ${outFile}`);
    } else {
      const topImages = products.slice(0, 3).map(p => p.image).filter(Boolean).join(',');
      const createdPost = await publishToWordPress(article, cat, topImages, products);
      console.log(`\n✅ ĐÃ ĐĂNG BÀI THÀNH CÔNG!`);
      console.log(`🆔 Post ID   : ${createdPost.id}`);
      console.log(`🔗 Link bài  : ${createdPost.link}`);
      console.log(`📌 Trạng thái: ${createdPost.status}`);
    }
  }

  console.log(`\n===============================================================`);
  console.log(`🎉 HOÀN THÀNH XỬ LÝ!`);
  console.log(`===============================================================\n`);
}

main().catch(err => {
  console.error('\n❌ RẤT TIẾC ĐÃ XẢY RA LỖI:', err.message);
  process.exit(1);
});
