#!/usr/bin/env node

const STORE_URL = process.env.WP_SITE_URL || 'https://lucas.vn';
const WP_USER = process.env.WP_USERNAME || 'luucat';
const WP_PASS = process.env.WP_APP_PASSWORD || 'FVLL lVs8 c21w 8RO5 kbzf OYk4';

const auth = Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');

// Danh sách từ cấm theo Luật Quảng cáo Việt Nam
const REPLACEMENTS = [
  { from: /Tốt Nhất/gi, to: 'Đáng Mua' },
  { from: /nhất/gi, to: 'đáng mua' },
  { from: /số 1/gi, to: 'chất lượng' },
  { from: /số một/gi, to: 'chất lượng' },
  { from: /duy nhất/gi, to: 'hàng đầu' },
  { from: /cực kỳ/gi, to: 'rất' },
  { from: /siêu phẩm/gi, to: 'sản phẩm nổi bật' },
  { from: /đỉnh cao/gi, to: 'cao cấp' },
  { from: /xịn xò/gi, to: 'chất lượng' }
];

const getHeaders = () => ({
  'Authorization': `Basic ${auth}`,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
});

async function updateTopPosts() {
  console.log('===============================================================');
  console.log('🚀 CẬP NHẬT TẤT CẢ CÁC BÀI VIẾT TOP LISTICLE CŨ TRÊN LUCAS.VN');
  console.log('===============================================================\n');

  let page = 1;
  let allTopPosts = [];

  while (true) {
    const res = await fetch(`${STORE_URL}/wp-json/wp/v2/posts?search=Top&per_page=100&page=${page}`, {
      headers: getHeaders()
    });
    if (!res.ok) break;
    const posts = await res.json();
    if (!posts.length) break;

    const filtered = posts.filter(p => p.title.rendered.toLowerCase().includes('top'));
    allTopPosts.push(...filtered);
    if (posts.length < 100) break;
    page++;
  }

  console.log(`📋 Đã tìm thấy ${allTopPosts.length} bài viết dạng Top Listicle cần cập nhật.\n`);

  let updatedCount = 0;

  for (const p of allTopPosts) {
    let title = p.title.rendered;
    let content = p.content.rendered;
    let modified = false;

    // 1. Thay thế từ cấm trong tiêu đề
    REPLACEMENTS.forEach(r => {
      if (r.from.test(title)) {
        title = title.replace(r.from, r.to);
        modified = true;
      }
    });

    // 2. Làm sạch ez-toc spans
    content = content.replace(/<span class="ez-toc-section[^"]*"[^>]*><\/span>/gi, '');
    content = content.replace(/<span class="ez-toc-section-end"[^>]*><\/span>/gi, '');

    // 3. Xóa số thứ tự ở đầu thẻ <h3> (tránh lỗi 2.1. 1.)
    content = content.replace(/<h3([^>]*)>\s*\d+[\.\)]\s*/gi, '<h3$1>');

    // 4. Thay thế từ cấm trong nội dung
    REPLACEMENTS.forEach(r => {
      if (r.from.test(content)) {
        content = content.replace(r.from, r.to);
        modified = true;
      }
    });

    // 5. Chuyển thẻ h3/h4/h5 trong widget quảng cáo thành thẻ p
    content = content.replace(/<h[1-6][^>]*>([\s\S]*?ƯU ĐÃI ĐẶC BIỆT[\s\S]*?)<\/h[1-6]>/gi, '<p style="color: #C9A227; margin: 0 0 10px 0; font-size: 20px; font-weight: bold; text-transform: uppercase;">$1</p>');
    content = content.replace(/<h[1-6][^>]*>([\s\S]*?Gợi Ý Xem Thêm[\s\S]*?)<\/h[1-6]>/gi, '<p style="margin: 0 0 10px 0; color: #0B1B2E; font-size: 16px; font-weight: bold;">$1</p>');

    // 6. Thêm lazy loading cho ảnh
    content = content.replace(/<img\s+/gi, '<img loading="lazy" ');

    // 7. Thêm Voucher Banner & Internal Links nếu thiếu
    if (!content.includes('LUCAS50K')) {
      const voucherBanner = `
<div style="background: linear-gradient(135deg, #0B1B2E 0%, #152A45 100%); color: #FFFFFF; padding: 24px; border-radius: 16px; margin: 36px 0; border: 2px solid #C9A227; text-align: center; box-shadow: 0 8px 24px rgba(11,27,46,0.15);">
  <p style="color: #C9A227; margin: 0 0 10px 0; font-size: 20px; font-weight: bold; text-transform: uppercase;">🎁 ƯU ĐÃI ĐẶC BIỆT DÀNH CHO BẠN ĐỌC BLOG LUCAS COMBO</p>
  <p style="margin: 0 0 16px 0; font-size: 15px; color: #E2E8F0; line-height: 1.6;">Nhập mã <strong style="background: #C9A227; color: #0B1B2E; padding: 4px 10px; border-radius: 6px; font-size: 16px; font-weight: 800;">LUCAS50K</strong> khi thanh toán tại lucas.vn để được <strong>Giảm Ngay 50.000đ</strong> cho đơn hàng phụ kiện trên 500k!</p>
  <a href="https://lucas.vn" style="background: #C9A227; color: #0B1B2E; padding: 12px 28px; border-radius: 8px; font-weight: bold; text-decoration: none; display: inline-block; font-size: 15px;">Khám Phá Phụ Kiện Chính Hãng Ngay ›</a>
</div>`;

      const internalLinkBox = `
<div style="background: #F8FAFC; border-left: 4px solid #0B1B2E; padding: 18px 20px; border-radius: 8px; margin: 30px 0;">
  <p style="margin: 0 0 10px 0; color: #0B1B2E; font-size: 16px; font-weight: bold;">📌 Gợi Ý Xem Thêm Tại Lucas Combo:</p>
  <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 14px; line-height: 1.8;">
    <li><a href="https://lucas.vn/danh-muc/tui-chong-soc-macbook" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Xem toàn bộ Phụ Kiện Túi Chống Sốc & Balo MacBook Chính Hãng</a></li>
    <li><a href="https://lucas.vn/danh-muc/dan-macbook" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Bộ Dán Màn Hình & Vỏ Máy Bảo Vệ Apple</a></li>
    <li><a href="https://lucas.vn/danh-muc/hub-chuyen-doi" style="color: #0B1B2E; font-weight: 600; text-decoration: underline;">Hub Chuyển Đổi Type-C Đa Năng Cho iPad & Laptop</a></li>
  </ul>
</div>`;

      content = content + voucherBanner + internalLinkBox;
      modified = true;
    }

    // Gửi request cập nhật
    try {
      const updateRes = await fetch(`${STORE_URL}/wp-json/wp/v2/posts/${p.id}`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          content,
          meta: {
            _yoast_wpseo_title: title,
            _yoast_wpseo_metadesc: p.excerpt?.rendered?.replace(/<[^>]*>/g, '').slice(0, 150) || title
          }
        })
      });

      if (updateRes.ok) {
        updatedCount++;
        console.log(`✅ [${updatedCount}/${allTopPosts.length}] Đã cập nhật thành công bài viết [ID: ${p.id}]: "${title}"`);
      } else {
        console.warn(`⚠️ [ID: ${p.id}] Lỗi HTTP ${updateRes.status}`);
      }
    } catch (e) {
      console.warn(`⚠️ [ID: ${p.id}] Lỗi: ${e.message}`);
    }

    // Nghỉ 1.2s giữa mỗi bài viết để tránh bị Firewall/Wordfence chặn rate limit 403
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n===============================================================');
  console.log(`🎉 TỔNG KẾT: ĐÃ CẬP NHẬT HOÀN TẤT ${updatedCount}/${allTopPosts.length} BÀI VIẾT TOP CŨ!`);
  console.log('===============================================================\n');
}

updateTopPosts();
