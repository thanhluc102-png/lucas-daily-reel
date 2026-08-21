import fs from 'fs';
import path from 'path';

// Load .env file
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  env.split('\n').forEach(l => {
    const m = l.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
}

const WP_SITE = process.env.WP_SITE_URL || 'https://lucas.vn';
const WP_USER = process.env.WP_USERNAME || 'luucat';
const WP_PASS = process.env.WP_APP_PASSWORD || 'FVLL lVs8 c21w 8RO5 kbzf OYk4';
const authHeader = 'Basic ' + Buffer.from(`${WP_USER}:${WP_PASS}`).toString('base64');
const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function formatVnd(amount) {
  if (!amount) return '';
  const num = Number(amount);
  return num.toLocaleString('vi-VN').replace(/,/g, '.') + ' ₫';
}

async function fixAllZeroPricePosts() {
  console.log('🚀 Đang quét toàn bộ bài viết trên lucas.vn để sửa tất cả sản phẩm bị 0 ₫...\n');
  let totalFixed = 0;

  for (let page = 1; page <= 10; page++) {
    console.log(`🔍 Đang kiểm tra trang bài viết #${page}...`);
    const res = await fetch(`${WP_SITE}/wp-json/wp/v2/posts?per_page=50&page=${page}`, { headers: { 'User-Agent': ua } });
    if (!res.ok) break;
    const posts = await res.json();
    if (!posts.length) break;

    for (const post of posts) {
      let content = post.content.rendered;
      if (!content.includes('0 ₫') && !content.includes('0&nbsp;₫') && !content.includes('>0 ₫<') && !content.includes('>0đ<')) {
        continue;
      }

      console.log(`📌 Phát hiện bài viết dính lỗi 0 ₫ -> ID: ${post.id} | Title: "${post.title.rendered}"`);

      let updatedContent = content;

      // 1. Quét tìm khối Widget Box sản phẩm có 0 ₫ và lấy Tên sản phẩm trực tiếp từ HTML
      const widgetBoxRegex = /<div style="font-size:15px;font-weight:600;color:#222222;line-height:1.35;margin:0 0 4px">([^<]+)<\/div>\s*<div style="font-size:19px;font-weight:700;color:#ff6b00;margin:0 0 8px">0\s*₫<\/div>/gi;

      let m;
      while ((m = widgetBoxRegex.exec(content)) !== null) {
        const prodTitle = m[1].trim();
        const targetStr = m[0];
        console.log(`   🔍 Đang tra giá cho sản phẩm trong widget box: "${prodTitle}"`);

        const pRes = await fetch(`${WP_SITE}/wp-json/wc/store/v1/products?search=${encodeURIComponent(prodTitle)}`, { headers: { 'User-Agent': ua } });
        if (pRes.ok) {
          const pData = await pRes.json();
          const p = pData[0];
          if (p && p.prices) {
            const minorUnit = p.prices.currency_minor_unit !== undefined ? Number(p.prices.currency_minor_unit) : 0;
            const div = 10 ** minorUnit;
            const pVal = Number(p.prices.price || 0);
            const minVal = Number(p.prices.price_range?.min_amount || 0);
            const regVal = Number(p.prices.regular_price || 0);
            const saleVal = Number(p.prices.sale_price || 0);
            const rawPrice = pVal > 0 ? pVal : (minVal > 0 ? minVal : (saleVal > 0 ? saleVal : regVal));
            const priceNum = Math.round(rawPrice / div);

            if (priceNum > 0) {
              const formattedVnd = formatVnd(priceNum);
              console.log(`   💰 Lấy được giá chuẩn cho "${prodTitle}" -> ${formattedVnd}`);
              const replaceStr = `<div style="font-size:15px;font-weight:600;color:#222222;line-height:1.35;margin:0 0 4px">${prodTitle}</div>\n<div style="font-size:19px;font-weight:700;color:#ff6b00;margin:0 0 8px">${formattedVnd}</div>`;
              updatedContent = updatedContent.replace(targetStr, replaceStr);
            }
          }
        }
      }

      // 2. Tìm tất cả link sản phẩm trong bài: href=".../san-pham/..."
      const matches = content.match(/href="([^"]*san-pham\/[^"]+)"/gi) || [];
      const prodUrls = Array.from(new Set(matches.map(m => m.replace(/^href="/, '').replace(/"$/, ''))));

      for (const prodUrl of prodUrls) {
        const slugMatch = prodUrl.match(/\/san-pham\/([^\/]+)/);
        if (!slugMatch) continue;
        const slug = slugMatch[1];

        const pRes = await fetch(`${WP_SITE}/wp-json/wc/store/v1/products?slug=${slug}`, { headers: { 'User-Agent': ua } });
        if (!pRes.ok) continue;
        const pData = await pRes.json();
        const p = pData[0];
        if (!p) continue;

        let priceNum = 0;
        if (p.prices) {
          const minorUnit = p.prices.currency_minor_unit !== undefined ? Number(p.prices.currency_minor_unit) : 0;
          const div = 10 ** minorUnit;
          const pVal = Number(p.prices.price || 0);
          const minVal = Number(p.prices.price_range?.min_amount || 0);
          const regVal = Number(p.prices.regular_price || 0);
          const saleVal = Number(p.prices.sale_price || 0);
          const rawPrice = pVal > 0 ? pVal : (minVal > 0 ? minVal : (saleVal > 0 ? saleVal : regVal));
          priceNum = Math.round(rawPrice / div);
        } else {
          priceNum = Number(p.price || p.sale_price || p.regular_price || 0);
        }

        if (priceNum > 0) {
          const formattedVnd = formatVnd(priceNum);
          updatedContent = updatedContent.replace(
            /(<strong>Giá tham khảo:<\/strong>\s*)0\s*đ/gi,
            `$1${formattedVnd}`
          );
        }
      }

      if (updatedContent !== content) {
        const updateRes = await fetch(`${WP_SITE}/wp-json/wp/v2/posts/${post.id}`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
            'User-Agent': ua
          },
          body: JSON.stringify({ content: updatedContent })
        });

        if (updateRes.ok) {
          console.log(`   ✅ ĐÃ SỬA VÀ ĐỔI GIÁ CHUẨN THÀNH CÔNG POST ID: ${post.id}`);
          totalFixed++;
        } else {
          const errText = await updateRes.text();
          console.error(`   ❌ Lỗi cập nhật Post ID ${post.id}: ${updateRes.status} - ${errText.slice(0, 150)}`);
        }
      }
    }
  }

  console.log(`\n===============================================================`);
  console.log(`🎉 TỔNG KẾT: Đã kiểm tra và sửa hoàn tất ${totalFixed} bài viết dính lỗi 0 ₫!`);
  console.log(`===============================================================`);
}

fixAllZeroPricePosts();
