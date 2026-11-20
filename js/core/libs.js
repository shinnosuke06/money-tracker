/*
 * 外部ライブラリの読み込み(CDN)
 * 必要になった時点で読み込む。読み込めなくてもアプリ本体は動く。
 * integrity(SRI)で、配信されたファイルが改ざんされていないことを確認する。
 */
(function (root) {
  'use strict';
  const MT = (root.MT = root.MT || {});

  const LIBS = {
    chart: {
      global: 'Chart',
      src: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
      integrity: 'sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ',
    },
    // カードの明細のスクリーンショットを、スマホの中で読み取る(js/features/payments/cards-view.js)。
    // 本体のほかに、読み取りの部品(tesseract.js-core)と日本語のデータ(@tesseract.js-data/jpn)を、版を固定して jsDelivr から受け取る
    tesseract: {
      global: 'Tesseract',
      src: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      integrity: 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F',
    },
    // 旧・ポケカ管理アプリのバックアップ("LZ:" で始まるもの)の展開に使う
    lzstring: {
      global: 'LZString',
      src: 'https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js',
      integrity: 'sha384-0d+Gr7vM4Drod8E3hXKgciWJSWbjD/opKLLygI9ktiWbuvlDwQLzU46wJ9s5gsp7',
    },
  };

  const pending = {};

  function load(name) {
    const lib = LIBS[name];
    if (!lib) return Promise.reject(new Error('unknown library: ' + name));
    if (root[lib.global]) return Promise.resolve(root[lib.global]);
    if (pending[name]) return pending[name];
    pending[name] = new Promise((resolve, reject) => {
      const s = root.document.createElement('script');
      s.src = lib.src;
      s.integrity = lib.integrity;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.async = true;
      s.onload = () => (root[lib.global] ? resolve(root[lib.global]) : reject(new Error('library not found')));
      s.onerror = () => {
        delete pending[name]; // 次に表示するときにもう一度試す
        s.remove();
        reject(new Error('failed to load ' + name));
      };
      root.document.head.append(s);
    });
    return pending[name];
  }

  MT.libs = { load };
})(window);
