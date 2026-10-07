// 지금 보고 있는 탭에서 실행된다. 화면에 보이는 글자와 표만 모은다(쿠키·비밀번호·입력값은 읽지 않음).
(() => {
  const url = location.href, host = location.hostname;
  const kind = /blackkiwi|keywordtool|keyword-tool|keywordsound|pandarank|itemscout|searchad\.naver\.com/i.test(url) ? 'keywords'
    : /admin\.blog\.naver\.com/.test(host) || /blog\.stat|\/stat\//.test(url) ? (/\/post|cv|views?/i.test(url) ? 'posts' : 'naver')
    : /brandconnect|shopping-connect|shoppingconnect/i.test(url) ? (/report|settle|perform|revenue|stat|income|정산/i.test(url) ? 'earnings' : 'products')
    : /myrealtrip/i.test(host) ? (/partner|report|settle|revenue|stat/i.test(url) ? 'earnings' : 'products')
    : /3hours|sesigan|세시간/i.test(url) ? 'earnings'
    : /adpost/i.test(host) ? 'earnings' : 'products';
  const clean = t => String(t || '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const tables = [...document.querySelectorAll('table')].slice(0, 8).map(t => [...t.rows].slice(0, 300).map(r => [...r.cells].map(c => clean(c.innerText)).join(' | ')).join('\n')).filter(Boolean);
  const main = document.querySelector('main, [role="main"], #content, .content') || document.body;
  let text = clean(main.innerText);
  if (text.length > 60000) text = text.slice(0, 60000);
  const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https:\/\//.test(h) && /naver\.me|brandconnect|smartstore|myrealtrip|link\.|\/p\/|product/i.test(h)).slice(0, 80);
  return {id: crypto.randomUUID(), kind, url, title: document.title.slice(0, 200), text, tables, links: [...new Set(links)], capturedAt: new Date().toISOString()};
})();
