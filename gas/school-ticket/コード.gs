/**
 * マンダラ通行証（学校の GAS）【試作】
 * 設計図：docs/設計_学校のGASで生徒の本人確認.md（マンダラ発想法のリポジトリ）
 *
 * 開いた人の学校のアドレスを自動で読み、「この人はうちの学校の人です」という通行証を作って、
 * マンダラ発想法へ戻すボタンを出す。T-science CHAT のログイン用アプリと同じ形。
 *
 * デプロイの設定：実行ユーザー＝自分（デプロイした先生）／アクセス＝（学校のドメイン）の全員
 * 求める権限：アドレスの参照（userinfo.email）だけ。デプロイした先生が1回許可する。生徒には許可の画面は出ない（T2 で確認）
 *
 * スクリプト プロパティ（エディタの「プロジェクトの設定」→「スクリプト プロパティ」。チャットやファイルには書かない）
 *   TICKET_SECRET : 署名の合言葉。Supabase の秘密の設定 SCHOOL_TICKET_SECRET と同じ値
 *   ID_SALT       : 本人の印を作る合言葉。ここだけに置く（Supabase にも置かない）
 *   RETURN_URLS   : 戻ってよいマンダラ発想法のアドレス（カンマ区切り。例：https://〇〇.vercel.app/）
 *   SCHOOL_DOMAIN : 学校のドメイン（例：example.ed.jp）
 *   SUPABASE_URL  : Supabase の接続先（例：https://〇〇.supabase.co）。Supabase が止まらないようにする keepAlive で使う
 *   SUPABASE_KEY  : Supabase の公開用の publishable キー（アプリにも入っている、見られてもよいキー。service_role は入れない）
 *   TEACHER_EMAILS: 先生のアドレス（カンマか改行で区切る）。ここに書いたアドレスが「先生」、それ以外はすべて「生徒」
 *                   先生は、その学校の生徒が作ったマンダラを全部見られる。書きかえられるのは、この GAS の持ち主だけにしておく
 *                   （置く共有ドライブのメンバーを、持ち主だけにする）
 *
 * 生徒のアドレスは、通行証にも入れない。入れるのは、アドレスと ID_SALT から作った読めない印と、先生か生徒かだけ。
 */

var TICKET_TTL_SEC = 120; // 通行証は2分で切れる

function doGet(e) {
  var p = PropertiesService.getScriptProperties();
  var secret = p.getProperty('TICKET_SECRET');
  var salt = p.getProperty('ID_SALT');
  var domain = (p.getProperty('SCHOOL_DOMAIN') || '').toLowerCase();
  var allowed = (p.getProperty('RETURN_URLS') || '').split(',').map(normalizeUrl_).filter(String);
  var ret = normalizeUrl_(e && e.parameter && e.parameter['return']);
  var state = String((e && e.parameter && e.parameter.state) || '');
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var teachers = (p.getProperty('TEACHER_EMAILS') || '').toLowerCase().split(/[\s,]+/).filter(String);
  var role = teachers.indexOf(email) >= 0 ? 'teacher' : 'student';

  var error = '';
  var nextUrl = '';
  if (!secret || !salt || !domain || allowed.length === 0) {
    error = 'マンダラ通行証の設定がまだ済んでいません（先生にお知らせください）。';
  } else if (allowed.indexOf(ret) < 0) {
    error = '戻り先のアドレスが登録されていません。マンダラ発想法の「学校のアカウントで入る」から開いてください。';
  } else if (!/^[A-Za-z0-9_-]{16,64}$/.test(state)) {
    error = '画面の番号が正しくありません。マンダラ発想法の「学校のアカウントで入る」から、もう一度開いてください。';
  } else if (!email) {
    error = '学校のアカウントのアドレスを確かめられませんでした。学校のアカウントでログインしているか確かめてください。';
  } else if (email.slice(-(domain.length + 1)) !== '@' + domain) {
    error = '学校のアカウントで開いてください。';
  } else {
    nextUrl = ret + '#ticket=' + encodeURIComponent(makeTicket_(email, domain, role, state, secret, salt));
  }

  var tpl = HtmlService.createTemplateFromFile('bridge');
  tpl.error = error;
  tpl.nextUrl = nextUrl;
  tpl.isTeacher = role === 'teacher';
  return tpl.evaluate()
    .setTitle('マンダラ通行証')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 戻り先のアドレスをそろえる（前後の空白を取り、最後の / を付ける） */
function normalizeUrl_(u) {
  var s = String(u || '').trim();
  if (!s) return '';
  return s.charAt(s.length - 1) === '/' ? s : s + '/';
}

/** 本人の印：HMAC-SHA256(ID_SALT, アドレス) の16進数（64文字）。アドレスには戻せない */
function subjectOf_(email, salt) {
  var bytes = Utilities.computeHmacSha256Signature(email, salt);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function makeTicket_(email, domain, role, state, secret, salt) {
  var payload = JSON.stringify({
    v: 1,
    sub: subjectOf_(email, salt),
    dom: domain,
    role: role,
    state: state,
    nonce: Utilities.getUuid().replace(/-/g, ''),
    exp: Math.floor(Date.now() / 1000) + TICKET_TTL_SEC
  });
  var data = Utilities.base64EncodeWebSafe(payload, Utilities.Charset.UTF_8);
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, secret));
  return data + '.' + sig;
}

/**
 * はじめに1回だけ、エディタで選んで「実行」する。
 * 署名の合言葉（TICKET_SECRET）と、本人の印の合言葉（ID_SALT）を作って、スクリプトプロパティに入れる。
 * すでにあれば作り直さない（作り直すと、生徒のアカウントが全部「別の人」になるため）。
 * TICKET_SECRET は「実行ログ」に1回だけ出るので、Supabase の秘密の設定 SCHOOL_TICKET_SECRET に貼る。
 * チャットやファイルには貼らない。ID_SALT はどこにも写さない。
 */
function setupSecrets() {
  var p = PropertiesService.getScriptProperties();
  var made = [];
  if (!p.getProperty('TICKET_SECRET')) { p.setProperty('TICKET_SECRET', randomSecret_()); made.push('TICKET_SECRET'); }
  if (!p.getProperty('ID_SALT')) { p.setProperty('ID_SALT', randomSecret_()); made.push('ID_SALT'); }
  if (!p.getProperty('SCHOOL_DOMAIN')) { p.setProperty('SCHOOL_DOMAIN', Session.getEffectiveUser().getEmail().split('@')[1] || ''); made.push('SCHOOL_DOMAIN'); }
  Logger.log('作ったもの：' + (made.length ? made.join('、') : 'なし（もう設定されています）'));
  if (made.indexOf('TICKET_SECRET') >= 0) {
    Logger.log('Supabase の SCHOOL_TICKET_SECRET に貼る値（チャットには貼らない）：' + p.getProperty('TICKET_SECRET'));
  }
  Logger.log('RETURN_URLS（戻ってよいアドレス）は、スクリプトプロパティに手で入れてください。');
}

function randomSecret_() {
  var s = '';
  for (var i = 0; i < 2; i++) s += Utilities.getUuid().replace(/-/g, '');
  return s; // 64文字（16進数）
}

/**
 * Supabase が止まらないようにする（無料プランは、1週間使われないと止まる）。
 * 毎日1回、トリガーから動く。Supabase の keepalive()（SQL 010）を呼ぶだけで、生徒のデータは読まない。
 * 結果は、スクリプトプロパティ LAST_KEEPALIVE に残す（「プロジェクトの設定」で見られる）。
 */
function keepAlive() {
  var p = PropertiesService.getScriptProperties();
  var url = (p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = p.getProperty('SUPABASE_KEY') || '';
  if (!url || !key) {
    Logger.log('SUPABASE_URL と SUPABASE_KEY をスクリプトプロパティに入れてください。');
    return;
  }
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/keepalive', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: '{}',
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var ok = code === 200 && String(res.getContentText()).indexOf('true') >= 0;
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  p.setProperty('LAST_KEEPALIVE', stamp + (ok ? ' 成功' : ' 失敗（' + code + '）'));
  Logger.log(ok ? 'Supabase は動いています。' : 'Supabase に届きませんでした（' + code + '）。止まっていないか、Supabase の画面で確かめてください。');
}

/**
 * はじめに1回だけ、エディタで選んで「実行」する。keepAlive を毎日1回（朝4時ごろ）動かすトリガーを入れる。
 * 何回実行しても、トリガーは1つだけになる。
 */
function setupKeepAlive() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'keepAlive') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('keepAlive').timeBased().everyDays(1).atHour(4).create();
  keepAlive();
  Logger.log('毎日1回 keepAlive が動くようにしました。');
}
