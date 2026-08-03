#!/usr/bin/env node
'use strict';

// remon 問題データ検証スクリプト
//
// index.html の PRELOAD を取り出して、問題を追加したあとに壊れやすい点を検査する。
// 使い方:  node validate-questions.js  [index.htmlのパス]
// 終了コード: 全項目パス=0 / 違反あり=1 / 読み込み失敗=2
// 警告（全角の式記号）は終了コードに影響しない。

var fs = require('fs');
var path = require('path');

var SUBJECT_NAMES = {
  kokugo: '国語', sugaku: '数学', rika: '理科',
  chiri: '地理', rekishi: '歴史', eigo: '英語'
};

var target = process.argv[2] || path.join(__dirname, 'index.html');

// ── PRELOAD の取り出し ───────────────────────────────────
// PRELOAD は index.html 内の1行にまるごと入っている（整形して改行を入れないこと）。
function extractPreload(file) {
  var src;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { error: file + ' を読めません: ' + e.message };
  }
  var lines = src.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('var PRELOAD=') !== 0) continue;
    var json = lines[i].slice('var PRELOAD='.length).replace(/;\s*$/, '');
    try {
      return { data: JSON.parse(json), line: i + 1 };
    } catch (e) {
      return { error: 'PRELOAD を JSON として読めません（' + file + ' の ' + (i + 1) + '行目）: ' + e.message };
    }
  }
  return { error: file + ' に「var PRELOAD=」で始まる行が見つかりません' };
}

// ── 出力ヘルパ ───────────────────────────────────────────
var MAX_SHOW = 20; // 1項目あたりの該当箇所の表示上限

function subjectLabel(sk) {
  return (SUBJECT_NAMES[sk] || sk) + '(' + sk + ')';
}
function clip(s, n) {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function where(set, qIndex) {
  // PRELOAD は1行なので行番号は役に立たない。教科・単元・単元内の問題番号で示す。
  return subjectLabel(set.subject) + ' / ' + set.unit +
    (qIndex == null ? '' : ' / ' + (qIndex + 1) + '問目');
}
// 教科ごとの入れ物（問題文・単元名をキーにするので、素のオブジェクトは使わない）
function bucket(store, sk) {
  if (!store[sk]) store[sk] = Object.create(null);
  return store[sk];
}

var checks = [];
function report(name, violations) {
  checks.push({ name: name, violations: violations });
}

// 警告は違反として数えない（終了コードを変えない）
var warnings = [];
function warn(name, items) {
  warnings.push({ name: name, items: items });
}

// ── 想定外の文字種 ───────────────────────────────────────
// ひらがな・カタカナ・漢字・英数字・一般的な記号・ギリシャ文字（π など）を許す。
// キリル文字やハングル、半角カタカナのように、見た目では気づきにくい混入を見つける。
var ALLOWED_CHAR = new RegExp('[' + [
  '\\u0020-\\u007E',  // 半角の英数字・記号
  '\\u00A0-\\u00FF',  // ° ± ² ³ × ÷ など
  '\\u0370-\\u03FF',  // ギリシャ文字（π α など）
  '\\u2000-\\u206F',  // … ‥ “ ” などの約物
  '\\u2100-\\u214F',  // ℓ ℃ № など
  '\\u2190-\\u21FF',  // → ← などの矢印
  '\\u2200-\\u22FF',  // ∠ ⊥ ∥ √ ≠ などの数学記号
  '\\u25A0-\\u25FF',  // △ ○ □ などの図形
  '\\u2700-\\u27BF',  // ✕ など
  '\\u3000-\\u303F',  // 全角空白・、。「」など
  '\\u3041-\\u309F',  // ひらがな
  '\\u30A0-\\u30FF',  // カタカナ
  '\\u3400-\\u4DBF',  // 漢字（拡張A）
  '\\u4E00-\\u9FFF',  // 漢字
  '\\uF900-\\uFAFF',  // 漢字（互換）
  '\\uFF01-\\uFF60'   // 全角の英数字・記号
].join('') + ']');

// サロゲートペアを1文字として数えるため Array.from を使う
function oddChars(text) {
  var found = [];
  Array.from(String(text)).forEach(function (ch) {
    if (ALLOWED_CHAR.test(ch)) return;
    if (found.indexOf(ch) < 0) found.push(ch);
  });
  return found;
}
function charLabel(ch) {
  return '「' + ch + '」(U+' + ch.codePointAt(0).toString(16).toUpperCase() + ')';
}

// 数式・座標に使う記号の全角（＝ － ＋ （ ））。
// 日本語の文章としての使用は許すので、式や座標として使われている疑いのあるものだけを拾う。
//   拾う:   y＝3x / x＋4 / （3, 6）
//   拾わない: 面積＝底辺×高さ÷2 / （正）×（負） / 適地適作（てきちてきさく）
// 判定は、全角記号が半角の英数字と隣り合っているか、
// 全角かっこの中身が半角の英数字だけでできているかで見る。
function fullwidthMathChars(text) {
  var s = String(text);
  var found = [];
  ['＝', '＋', '－'].forEach(function (ch) {
    var re = new RegExp('[0-9A-Za-z]\\s*' + ch + '|' + ch + '\\s*[0-9A-Za-z]');
    if (re.test(s)) found.push(ch);
  });
  if (/（[\s0-9A-Za-z,.+\-]+）/.test(s)) { found.push('（'); found.push('）'); }
  return found;
}

// ── 検査 ─────────────────────────────────────────────────
var loaded = extractPreload(target);

if (loaded.error) {
  console.log('remon 問題データ検証');
  console.log('対象: ' + target);
  console.log('');
  console.log('NG  PRELOAD が JSON として正しく読める');
  console.log('    ' + loaded.error);
  console.log('');
  console.log('結果: 検証を続行できません');
  process.exit(2);
}

var preload = loaded.data;

if (!Array.isArray(preload)) {
  console.log('remon 問題データ検証');
  console.log('対象: ' + target);
  console.log('');
  console.log('NG  PRELOAD が配列ではありません（' + typeof preload + '）');
  console.log('');
  console.log('結果: 検証を続行できません');
  process.exit(2);
}

report('PRELOAD が JSON として正しく読める', []); // ここに来た時点で成功している

var missingFields = [];
var badChoiceCount = [];
var dupChoiceInQuestion = [];
var dupQuestionInSubject = [];
var dupUnitName = [];
var badCharType = [];
var fullwidthMath = [];

var seenQuestion = Object.create(null); // 教科 -> 問題文 -> 初出の場所
var seenUnit = Object.create(null);     // 教科 -> 単元名 -> 初出の位置

var totalQuestions = 0;
var filledUnits = 0;
var bySubject = Object.create(null);

preload.forEach(function (set, setIndex) {
  var sk = set.subject;
  var questions = Array.isArray(set.questions) ? set.questions : [];

  // 単元名の重複（同一教科内）
  var units = bucket(seenUnit, sk);
  if (units[set.unit] != null) {
    dupUnitName.push({
      at: subjectLabel(sk) + ' / ' + set.unit,
      note: '配列の ' + (units[set.unit] + 1) + '番目と ' + (setIndex + 1) + '番目で重複'
    });
  } else {
    units[set.unit] = setIndex;
  }

  if (questions.length > 0) filledUnits++;
  totalQuestions += questions.length;
  bySubject[sk] = (bySubject[sk] || 0) + questions.length;

  var texts = bucket(seenQuestion, sk);

  questions.forEach(function (q, qi) {
    // 必須項目の欠落
    var lacking = [];
    if (!q || typeof q.question !== 'string' || q.question.trim() === '') lacking.push('question');
    if (!q || !Array.isArray(q.choices) || q.choices.length === 0) lacking.push('choices');
    if (!q || typeof q.explanation !== 'string' || q.explanation.trim() === '') lacking.push('explanation');
    if (lacking.length) {
      missingFields.push({
        at: where(set, qi),
        note: '不足: ' + lacking.join(', ') + ' / ' + clip(q && q.question, 40)
      });
      return; // 以降の検査は成立しないので飛ばす
    }

    // choices がちょうど4個
    if (q.choices.length !== 4) {
      badChoiceCount.push({
        at: where(set, qi),
        note: q.choices.length + '個 / ' + clip(q.question, 40)
      });
    }

    // 同一問題内で選択肢が重複していない（正解が一意に定まらなくなる）
    var dups = [];
    var seenChoice = Object.create(null);
    q.choices.forEach(function (c) {
      var key = String(c);
      if (seenChoice[key] && dups.indexOf(key) < 0) dups.push(key);
      seenChoice[key] = 1;
    });
    if (dups.length) {
      dupChoiceInQuestion.push({
        at: where(set, qi),
        note: '重複した選択肢: ' + dups.map(function (d) { return '「' + clip(d, 20) + '」'; }).join(' ') +
          ' / ' + clip(q.question, 40)
      });
    }

    // 同一教科内で問題文が重複していない
    // （重複すると mergePreload() が後から来た側を黙って捨てる）
    if (texts[q.question]) {
      dupQuestionInSubject.push({
        at: where(set, qi),
        note: '「' + clip(q.question, 40) + '」/ 初出: ' + texts[q.question] + ' → この問題は取り込まれず捨てられる'
      });
    } else {
      texts[q.question] = where(set, qi);
    }

    // 問題文・選択肢・解説をまとめて見る
    var whole = q.question + ' ' + q.choices.join(' ') + ' ' + q.explanation;

    // 想定外の文字が混じっていない
    var odd = oddChars(whole);
    if (odd.length) {
      badCharType.push({
        at: where(set, qi),
        note: '想定外の文字: ' + odd.map(charLabel).join(' ') + ' / ' + clip(q.question, 40)
      });
    }

    // 全角の式記号（警告）
    var fw = fullwidthMathChars(whole);
    if (fw.length) {
      fullwidthMath.push({
        at: where(set, qi),
        note: '全角: ' + fw.map(function (c) { return '「' + c + '」'; }).join(' ') + ' / ' + clip(q.question, 40)
      });
    }
  });
});

report('各問題に question / choices / explanation が揃っている', missingFields);
report('choices がちょうど4個', badChoiceCount);
report('同一問題内で選択肢が重複していない', dupChoiceInQuestion);
report('同一教科内で問題文が重複していない', dupQuestionInSubject);
report('単元名が重複していない', dupUnitName);
report('想定外の文字が混じっていない', badCharType);

warn('数式・座標に使う記号に全角が混じっている', fullwidthMath);

// ── 出力 ─────────────────────────────────────────────────
console.log('remon 問題データ検証');
console.log('対象: ' + target + '（' + loaded.line + '行目の PRELOAD）');
console.log('単元枠 ' + preload.length + '（問題あり ' + filledUnits + '） 問題 ' + totalQuestions + '問');

var subjectSummary = Object.keys(bySubject).map(function (sk) {
  return subjectLabel(sk) + ' ' + bySubject[sk] + '問';
}).join(' / ');
if (subjectSummary) console.log('内訳: ' + subjectSummary);
console.log('');

var totalViolations = 0;
checks.forEach(function (c) {
  var n = c.violations.length;
  totalViolations += n;
  if (n === 0) {
    console.log('OK  ' + c.name);
    return;
  }
  console.log('NG  ' + c.name + '  ' + n + '件');
  c.violations.slice(0, MAX_SHOW).forEach(function (v) {
    console.log('    - ' + v.at);
    console.log('      ' + v.note);
  });
  if (n > MAX_SHOW) console.log('    …ほか ' + (n - MAX_SHOW) + '件');
});

// 警告は違反として数えない。日本語の文章として全角を使うこともあるため、
// 直すかどうかは中身を見て判断する。
warnings.forEach(function (w) {
  if (w.items.length === 0) return;
  console.log('');
  console.log('警告  ' + w.name + '  ' + w.items.length + '件');
  w.items.slice(0, MAX_SHOW).forEach(function (v) {
    console.log('    - ' + v.at);
    console.log('      ' + v.note);
  });
  if (w.items.length > MAX_SHOW) console.log('    …ほか ' + (w.items.length - MAX_SHOW) + '件');
});

console.log('');
if (totalViolations === 0) {
  console.log('結果: 全項目パス');
  process.exit(0);
}
console.log('結果: ' + totalViolations + '件の違反');
process.exit(1);
