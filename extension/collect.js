// 지금 보고 있는 탭에서 실행된다. 화면에 보이는 글자와 표만 모은다(쿠키·비밀번호·입력값은 읽지 않음).
(() => {
  const url = location.href, host = location.hostname;
  // 브랜드커넥트(쇼핑 커넥트)는 지금 켜진 하위 탭으로 구분한다: 상품 찾기 → 상품, 판매 실적·정산 → 수익, 발급 링크 관리 → 링크(상품 아님).
  const activeTab = (() => { for (const el of document.querySelectorAll('[aria-current], [aria-selected="true"], .active, .on, .selected, .is-active, [class*="active"], [class*="selected"]')) { const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (/^(상품 ?찾기|판매 ?실적|발급 ?링크 ?관리|정산 ?관리|쇼핑 ?커넥트 ?소개)$/.test(t)) return t.replace(/\s+/g, ''); } return ''; })();
  const bcKind = activeTab === '상품찾기' ? 'products' : /판매실적|정산관리/.test(activeTab) ? 'earnings' : activeTab === '발급링크관리' ? 'links' : activeTab ? 'other' : '';
  const kind = /blackkiwi|keywordtool|keyword-tool|keywordsound|pandarank|itemscout|searchad\.naver\.com/i.test(url) ? 'keywords'
    : /admin\.blog\.naver\.com/.test(host) || /blog\.stat|\/stat\//.test(url) ? (/\/post|cv|views?/i.test(url) ? 'posts' : 'naver')
    : /brandconnect|shopping-connect|shoppingconnect/i.test(url) ? (bcKind || (/report|settle|perform|revenue|stat|income|정산/i.test(url) ? 'earnings' : 'products'))
    : /myrealtrip/i.test(host) ? (/partner|report|settle|revenue|stat/i.test(url) ? 'earnings' : 'products')
    : /3hours|sesigan|세시간/i.test(url) ? 'earnings'
    : /adpost/i.test(host) ? 'earnings' : 'products';
  const clean = t => String(t || '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const tables = [...document.querySelectorAll('table')].slice(0, 8).map(t => [...t.rows].slice(0, 300).map(r => [...r.cells].map(c => clean(c.innerText)).join(' | ')).join('\n')).filter(Boolean);
  const main = document.querySelector('main, [role="main"], #content, .content') || document.body;
  let text = clean(main.innerText);
  if (text.length > 60000) text = text.slice(0, 60000);
  const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => /^https:\/\//.test(h) && /naver\.me|brandconnect|smartstore|myrealtrip|link\.|\/p\/|product/i.test(h)).slice(0, 80);
  return {id: crypto.randomUUID(), kind, activeTab, url, title: document.title.slice(0, 200), text, tables, links: [...new Set(links)], capturedAt: new Date().toISOString()};
})();
