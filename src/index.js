const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  }
});
const nowIso = () => new Date().toISOString();
const id = () => crypto.randomUUID();

const b64 = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');

const utf8 = (s) => new TextEncoder().encode(s);
const digest = async (s) => hex(await crypto.subtle.digest('SHA-256', utf8(s)));

async function derive(secret, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: utf8(salt),
    iterations: 120000,
    hash: 'SHA-256'
  }, key, 256));
}

const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }

  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return out === 0;
};

function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowed = configured.includes(origin)
    ? origin
    : (configured.length ? configured[0] : '*');

  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization',
    'access-control-max-age': '86400',
    'vary': 'Origin'
  };
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validEmail(v) {
  return typeof v === 'string' &&
    v.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validPhone(v) {
  return typeof v === 'string' && /^\+?[0-9\s()\-]{8,20}$/.test(v);
}

function normalizePhone(v) {
  return String(v || '').replace(/[\s()\-]/g, '');
}

function normalizeKenyanPhone(value) {
  let phone = normalizePhone(value);

  if (phone.startsWith('+')) {
    phone = phone.slice(1);
  }

  if (phone.startsWith('0')) {
    phone = '254' + phone.slice(1);
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    return null;
  }

  return phone;
}

function kenyaTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((result, part) => {
    if (part.type !== 'literal') {
      result[part.type] = part.value;
    }
    return result;
  }, {});

  return parts.year + parts.month + parts.day +
    parts.hour + parts.minute + parts.second;
}

async function audit(
  db,
  actor,
  action,
  entityType = null,
  entityId = null,
  metadata = null
) {
  await db.prepare(`
    INSERT INTO gpc_audit_log
    (id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?)
  `).bind(
    id(),
    actor || null,
    action,
    entityType,
    entityId,
    metadata ? JSON.stringify(metadata) : null,
    nowIso()
  ).run();
}

async function failAttempt(db, key) {
  const now = Date.now();

  const row = await db.prepare(
    'SELECT * FROM gpc_login_attempts WHERE attempt_key=?'
  ).bind(key).first();

  if (!row || now - Date.parse(row.window_started_at) > 15 * 60 * 1000) {
    await db.prepare(`
      INSERT INTO gpc_login_attempts
      (attempt_key,failures,window_started_at,blocked_until)
      VALUES(?,1,?,NULL)
      ON CONFLICT(attempt_key) DO UPDATE SET
        failures=1,
        window_started_at=excluded.window_started_at,
        blocked_until=NULL
    `).bind(key, nowIso()).run();

    return;
  }

  const failures = Number(row.failures || 0) + 1;
  const blocked = failures >= 5
    ? new Date(now + 15 * 60 * 1000).toISOString()
    : null;

  await db.prepare(`
    UPDATE gpc_login_attempts
    SET failures=?,blocked_until=?
    WHERE attempt_key=?
  `).bind(failures, blocked, key).run();
}

async function clearAttempts(db, key) {
  await db.prepare(
    'DELETE FROM gpc_login_attempts WHERE attempt_key=?'
  ).bind(key).run();
}

async function newSession(db, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await db.prepare(`
    INSERT INTO gpc_sessions
    (id,user_id,token_hash,created_at,expires_at,last_seen_at)
    VALUES(?,?,?,?,?,?)
  `).bind(
    id(),
    userId,
    await digest(token),
    nowIso(),
    expires,
    nowIso()
  ).run();

  return { token, expiresAt: expires };
}

async function getUser(request, db) {
  const match = (request.headers.get('Authorization') || '')
    .match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return null;
  }

  const tokenHash = await digest(match[1]);

  const row = await db.prepare(`
    SELECT
      u.id,u.name,u.email,u.phone,u.role,u.status,
      s.id AS session_id,s.expires_at
    FROM gpc_sessions s
    JOIN gpc_users u ON u.id=s.user_id
    WHERE s.token_hash=?
      AND s.revoked_at IS NULL
      AND s.expires_at>?
    LIMIT 1
  `).bind(tokenHash, nowIso()).first();

  if (!row || row.status !== 'active') {
    return null;
  }

  await db.prepare(
    'UPDATE gpc_sessions SET last_seen_at=? WHERE id=?'
  ).bind(nowIso(), row.session_id).run();

  return row;
}

async function handle(request, env) {
  const headers = cors(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const url = new URL(request.url);
  const path = url.pathname;

  // Health check
  if (path === '/api/health' && request.method === 'GET') {
    let database = 'not_configured';

    if (env.DB) {
      try {
        await env.DB.prepare('SELECT 1 AS ok').first();
        database = 'connected';
      } catch {
        database = 'error';
      }
    }

    return json({
      ok: true,
      service: 'GODIA PRIME CONNECT SOLUTIONS API',
      time: nowIso(),
      database
    }, 200, headers);
  }

  // Existing static frontend
  if (!path.startsWith('/api/')) {
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return json({
      ok: false,
      message: 'Static assets binding ASSETS is not configured.'
    }, 404, headers);
  }

  // M-Pesa callback
  if (path === '/api/payments/mpesa/callback' && request.method === 'POST') {
    if (!env.DB) {
      return json({
        ok: false,
        message: 'Database binding DB is not configured.'
      }, 503, headers);
    }

    const payload = await bodyJson(request);
    const stk = payload?.Body?.stkCallback;

    if (!stk || !stk.CheckoutRequestID ||
        !Number.isFinite(Number(stk.ResultCode))) {
      return json({
        ResultCode: 0,
        ResultDesc: 'Callback acknowledged'
      }, 200, headers);
    }

    const resultCode = Number(stk.ResultCode);
    const items = stk.CallbackMetadata?.Item || [];
    const meta = Object.fromEntries(
      items.map(item => [item.Name, item.Value])
    );

    const status = resultCode === 0 ? 'success' : 'failed';

    try {
      await env.DB.prepare(`
        UPDATE gpc_mpesa_payments
        SET status=?,
            result_code=?,
            result_description=?,
            mpesa_receipt_number=?,
            transaction_date=?,
            phone_number=COALESCE(?,phone_number),
            updated_at=?
        WHERE checkout_request_id=?
      `).bind(
        status,
        resultCode,
        String(stk.ResultDesc || '').slice(0, 500),
        meta.MpesaReceiptNumber || null,
        meta.TransactionDate ? String(meta.TransactionDate) : null,
        meta.PhoneNumber ? String(meta.PhoneNumber) : null,
        nowIso(),
        stk.CheckoutRequestID
      ).run();
    } catch {
      // Do not pretend the database update succeeded.
      return json({
        ResultCode: 1,
        ResultDesc: 'Payment callback could not be saved.'
      }, 500, headers);
    }

    return json({
      ResultCode: 0,
      ResultDesc: 'Accepted'
    }, 200, headers);
  }

  // Check the signed-in user's payment status
  if (path === '/api/payments/mpesa/status' && request.method === 'GET') {
    if (!env.DB) {
      return json({
        ok: false,
        message: 'Database binding DB is not configured.'
      }, 503, headers);
    }

    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    const checkoutId = String(
      url.searchParams.get('checkout_request_id') || ''
    ).trim();

    if (!checkoutId) {
      return json({
        ok: false,
        message: 'checkout_request_id is required.'
      }, 400, headers);
    }

    const row = await env.DB.prepare(`
      SELECT id,amount,status,mpesa_receipt_number,
             result_description,created_at,updated_at
      FROM gpc_mpesa_payments
      WHERE checkout_request_id=? AND user_id=?
      LIMIT 1
    `).bind(checkoutId, user.id).first();

    if (!row) {
      return json({
        ok: false,
        message: 'Payment request not found.'
      }, 404, headers);
    }

    return json({ ok: true, payment: row }, 200, headers);
  }

  // Daraja Production STK Push
  if (path === '/api/payments/mpesa/stkpush' && request.method === 'POST') {
    if (!env.DB) {
      return json({
        ok: false,
        message: 'Database binding DB is not configured.'
      }, 503, headers);
    }

    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    const data = await bodyJson(request);

    if (!data) {
      return json({
        ok: false,
        message: 'Invalid JSON body.'
      }, 400, headers);
    }

    const amount = Number(data.amount);
    const phone = normalizeKenyanPhone(data.phone || user.phone);

    if (!Number.isInteger(amount) || amount < 1 || amount > 150000 || !phone) {
      return json({
        ok: false,
        message: 'Provide a whole KES amount between 1 and 150,000 and a valid Kenyan mobile number.'
      }, 400, headers);
    }

    // Fail closed: this handler must never silently use Sandbox.
    if (env.DARAJA_ENV !== 'production') {
      return json({
        ok: false,
        message: 'Daraja Production is required. No payment request was sent.'
      }, 503, headers);
    }

    if (
      !env.DARAJA_CONSUMER_KEY ||
      !env.DARAJA_CONSUMER_SECRET ||
      !env.DARAJA_SHORTCODE ||
      !env.DARAJA_PASSKEY ||
      !env.DARAJA_CALLBACK_URL
    ) {
      return json({
        ok: false,
        message: 'Daraja Production is not fully configured. Check the Worker variables and secrets.'
      }, 503, headers);
    }

    // This is the intended Till number. Safaricom must authorize it for STK Push.
    if (String(env.DARAJA_SHORTCODE).trim() !== '1692851') {
      return json({
        ok: false,
        message: 'DARAJA_SHORTCODE must be set to the authorized Buy Goods/Till number 1692851.'
      }, 503, headers);
    }

    const expectedCallback =
      'https://godia-prime-connect-enterprise-ltd.evangelistsimbiri236.workers.dev/api/payments/mpesa/callback';

    if (String(env.DARAJA_CALLBACK_URL).trim() !== expectedCallback) {
      return json({
        ok: false,
        message: 'The configured Daraja callback URL does not match the GODIA payment callback endpoint.'
      }, 503, headers);
    }

    const base = 'https://api.safaricom.co.ke';

    try {
      const auth = await fetch(
        base + '/oauth/v1/generate?grant_type=client_credentials',
        {
          headers: {
            Authorization: 'Basic ' + btoa(
              env.DARAJA_CONSUMER_KEY + ':' + env.DARAJA_CONSUMER_SECRET
            )
          }
        }
      );

      const authData = await auth.json();

      if (!auth.ok || !authData.access_token) {
        return json({
          ok: false,
          message: 'Daraja Production authentication failed. Check the Production credentials and app permissions.'
        }, 502, headers);
      }

      const timestamp = kenyaTimestamp();

      const password = btoa(
        env.DARAJA_SHORTCODE + env.DARAJA_PASSKEY + timestamp
      );

      const reference = String(data.account_reference || 'GODIA')
        .replace(/[^a-zA-Z0-9 ._-]/g, '')
        .slice(0, 12) || 'GODIA';

      const description = String(data.description || 'GODIA payment')
        .replace(/[^a-zA-Z0-9 ._-]/g, '')
        .slice(0, 13) || 'GODIA payment';

      const transactionType =
        env.DARAJA_TRANSACTION_TYPE || 'CustomerBuyGoodsOnline';

      if (!['CustomerBuyGoodsOnline', 'CustomerPayBillOnline'].includes(transactionType)) {
        return json({
          ok: false,
          message: 'Unsupported Daraja transaction type configuration.'
        }, 503, headers);
      }

      const stkRes = await fetch(
        base + '/mpesa/stkpush/v1/processrequest',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + authData.access_token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            BusinessShortCode: env.DARAJA_SHORTCODE,
            Password: password,
            Timestamp: timestamp,
            TransactionType: transactionType,
            Amount: amount,
            PartyA: phone,
            PartyB: env.DARAJA_SHORTCODE,
            PhoneNumber: phone,
            CallBackURL: env.DARAJA_CALLBACK_URL,
            AccountReference: reference,
            TransactionDesc: description
          })
        }
      );

      const result = await stkRes.json();

      if (!stkRes.ok || !result.CheckoutRequestID) {
        return json({
          ok: false,
          message: result.errorMessage ||
            result.ResponseDescription ||
            result.error_description ||
            'Daraja did not accept the STK request.'
        }, 502, headers);
      }

      const paymentId = id();

      // Save the accepted request. If this fails, do not claim it was recorded.
      try {
        await env.DB.prepare(`
          INSERT INTO gpc_mpesa_payments
          (id,user_id,amount,phone_number,status,merchant_request_id,
           checkout_request_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?)
        `).bind(
          paymentId,
          user.id,
          amount,
          phone,
          'pending',
          result.MerchantRequestID || null,
          result.CheckoutRequestID,
          nowIso(),
          nowIso()
        ).run();
      } catch {
        return json({
          ok: false,
          message: 'Safaricom accepted the request, but GODIA could not save the payment record. Check the Worker logs and D1 before retrying to avoid duplicate prompts.',
          checkout_request_id: result.CheckoutRequestID
        }, 500, headers);
      }

      try {
        await audit(
          env.DB,
          user.id,
          'mpesa.stkpush.requested',
          'mpesa_payment',
          paymentId,
          {
            amount,
            environment: 'production',
            till_number: '1692851'
          }
        );
      } catch {
        // Audit logging must not change the payment result after the payment row exists.
      }

      return json({
        ok: true,
        message: result.CustomerMessage ||
          'STK Push sent. Complete the prompt on your phone. Payment remains pending until Daraja confirms it.',
        payment_id: paymentId,
        merchant_request_id: result.MerchantRequestID,
        checkout_request_id: result.CheckoutRequestID,
        response_code: result.ResponseCode
      }, 200, headers);

    } catch {
      return json({
        ok: false,
        message: 'Could not complete the Daraja request. Check Worker logs and Production configuration before retrying.'
      }, 502, headers);
    }
  }

  // GODIA PRIME CONNECT — Authenticated Workers AI endpoint
  // This route is intentionally handled before the API allowlist below.
  if (path === '/api/ai/chat' && request.method === 'POST') {
    if (!env.DB) {
      return json({
        ok: false,
        message: 'Database binding DB is not configured.'
      }, 503, headers);
    }

    if (!env.AI || typeof env.AI.run !== 'function') {
      return json({
        ok: false,
        message: 'Workers AI binding AI is not configured.'
      }, 503, headers);
    }

    // Require an active, authenticated account.
    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required to use GODIA AI.'
      }, 401, headers);
    }

    const data = await bodyJson(request);

    if (!data) {
      return json({
        ok: false,
        message: 'Invalid JSON body.'
      }, 400, headers);
    }

    const message = typeof data.message === 'string'
      ? data.message.trim()
      : '';

    const allowedSources = ['ai-marketing', 'ai-agent', 'floating-assistant'];
    const source = allowedSources.includes(data.source) ? data.source : '';

    if (!message || message.length > 3000) {
      return json({
        ok: false,
        message: 'Enter a message containing between 1 and 3000 characters.'
      }, 400, headers);
    }

    if (!source) {
      return json({
        ok: false,
        message: 'Invalid AI source.'
      }, 400, headers);
    }

    const systemPrompt = `
You are GODIA PRIME AI for GODIA PRIME CONNECT SOLUTIONS, a Kenyan
business, marketplace, supply, jobs, and services platform.

For AI Agent or floating-assistant requests, help with business planning,
marketplace guidance, supplier communication, stock and sales guidance,
and clear English or Kiswahili. Do not pretend you have searched the live
marketplace, read live orders, or accessed the database unless those facts
are explicitly included in the user's message.

For AI Marketing requests, produce ready-to-use, truthful campaign copy,
WhatsApp messages, product descriptions, social posts, or calls to action
based on the user's request. Keep the wording suitable for Kenyan customers
and use KES only when the user provides or confirms a price.

Security and accuracy rules:
- Never invent actual products, suppliers, prices, stock, orders, customers,
  payments, or business records.
- Never reveal passwords, PINs, session tokens, API keys, or secrets.
- Never claim to have sent messages, published advertisements, completed
  payments, or changed records.
- Never approve or initiate a payment on the user's behalf.
- Do not make unsupported claims or guarantee business results.
- Respect the user's language. English or Kiswahili is acceptable.
`;

    try {
      const result = await env.AI.run(
        '@cf/meta/llama-3.1-8b-instruct',
        {
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: message
            }
          ],
          max_tokens: 800,
          temperature: 0.5
        }
      );

      const answer = typeof result?.response === 'string'
        ? result.response.trim()
        : '';

      if (!answer) {
        return json({
          ok: false,
          message: 'The AI service returned no answer. Please try again.'
        }, 502, headers);
      }

      return json({
        ok: true,
        answer,
        source,
        model: '@cf/meta/llama-3.1-8b-instruct'
      }, 200, headers);

    } catch {
      return json({
        ok: false,
        message: 'GODIA AI could not complete the request. Check Workers AI availability and Worker logs.'
      }, 502, headers);
    }
  }

  // Existing API routes
  const implemented = new Map([
    ['/api/auth/register', 'POST'],
    ['/api/auth/login', 'POST'],
    ['/api/auth/logout', 'POST'],
    ['/api/auth/me', 'GET'],
    ['/api/auth/forgot-password', 'POST'],
    ['/api/admin/health', 'GET'],
    ['/api/owner/customer-access', 'GET'],
    ['/api/owner/customer-access', 'POST'],
    ['/api/subscription/access', 'GET']
  ]);

  if (
    !(path === '/api/owner/customer-access' &&
      ['GET', 'POST'].includes(request.method)) &&
    implemented.get(path) !== request.method
  ) {
    return json({
      ok: false,
      message: 'API endpoint not implemented yet.'
    }, 404, headers);
  }

  if (!env.DB) {
    return json({
      ok: false,
      message: 'Database binding DB is not configured.'
    }, 503, headers);
  }

  // Registration
  if (path === '/api/auth/register' && request.method === 'POST') {
    const data = await bodyJson(request);

    if (!data) {
      return json({
        ok: false,
        message: 'Invalid JSON body.'
      }, 400, headers);
    }

    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    const phone = normalizePhone(data.phone);
    const password = String(data.password || '');
    const pin = String(data.pin || '');

    if (
      name.length < 2 ||
      name.length > 120 ||
      !validEmail(email) ||
      !validPhone(phone) ||
      password.length < 8 ||
      password.length > 256 ||
      !/^\d{4,8}$/.test(pin)
    ) {
      return json({
        ok: false,
        message: 'Provide a name, valid email and phone, password of at least 8 characters, and a 4–8 digit PIN.'
      }, 400, headers);
    }

    const duplicate = await env.DB.prepare(
      'SELECT id FROM gpc_users WHERE email=? OR phone=? LIMIT 1'
    ).bind(email, phone).first();

    if (duplicate) {
      return json({
        ok: false,
        message: 'An account with that email or phone already exists.'
      }, 409, headers);
    }

    const userId = id();
    const passSalt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const pinSalt = b64(crypto.getRandomValues(new Uint8Array(16)));

    try {
      await env.DB.prepare(`
        INSERT INTO gpc_users
        (id,name,email,phone,password_salt,password_hash,pin_salt,pin_hash,
         role,status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?, 'customer','active',?,?)
      `).bind(
        userId,
        name,
        email,
        phone,
        passSalt,
        await derive(password, passSalt),
        pinSalt,
        await derive(pin, pinSalt),
        nowIso(),
        nowIso()
      ).run();

      await audit(env.DB, userId, 'account.registered', 'user', userId, {
        role: 'customer'
      });
    } catch {
      return json({
        ok: false,
        message: 'Could not create the account. Check that the migration was applied and try again.'
      }, 500, headers);
    }

    return json({
      ok: true,
      success: true,
      message: 'Account registered. Sign in using your phone and PIN or email and password.'
    }, 201, headers);
  }

  // Login
  if (path === '/api/auth/login' && request.method === 'POST') {
    const data = await bodyJson(request);

    if (!data) {
      return json({
        ok: false,
        message: 'Invalid JSON body.'
      }, 400, headers);
    }

    const email = String(data.email || '').trim().toLowerCase();
    const phone = normalizePhone(data.phone);
    const byEmail = !!email;

    if (byEmail ? !validEmail(email) : !validPhone(phone)) {
      return json({
        ok: false,
        message: 'Enter a valid email or phone number.'
      }, 400, headers);
    }

    const key = await digest(byEmail ? 'email:' + email : 'phone:' + phone);

    const attempt = await env.DB.prepare(
      'SELECT * FROM gpc_login_attempts WHERE attempt_key=?'
    ).bind(key).first();

    if (attempt?.blocked_until && Date.parse(attempt.blocked_until) > Date.now()) {
      return json({
        ok: false,
        message: 'Too many attempts. Please wait 15 minutes before trying again.'
      }, 429, headers);
    }

    const user = await env.DB.prepare(
      'SELECT * FROM gpc_users WHERE ' +
      (byEmail ? 'email=?' : 'phone=?') +
      ' LIMIT 1'
    ).bind(byEmail ? email : phone).first();

    let valid = false;

    if (user && user.status === 'active') {
      if (byEmail && typeof data.password === 'string') {
        valid = same(
          await derive(data.password, user.password_salt),
          user.password_hash
        );
      } else if (
        !byEmail &&
        typeof data.pin === 'string' &&
        /^\d{4,8}$/.test(data.pin)
      ) {
        valid = same(
          await derive(data.pin, user.pin_salt),
          user.pin_hash
        );
      }
    }

    if (!valid) {
      await failAttempt(env.DB, key);

      return json({
        ok: false,
        message: 'The sign-in details are incorrect or the account is not active.'
      }, 401, headers);
    }

    await clearAttempts(env.DB, key);

    const session = await newSession(env.DB, user.id);

    await audit(env.DB, user.id, 'account.login', 'session', null);

    return json({
      ok: true,
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    }, 200, headers);
  }

  // Logout
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    const token = (request.headers.get('Authorization') || '')
      .replace(/^Bearer\s+/i, '');

    await env.DB.prepare(`
      UPDATE gpc_sessions
      SET revoked_at=?
      WHERE token_hash=? AND revoked_at IS NULL
    `).bind(nowIso(), await digest(token)).run();

    await audit(env.DB, user.id, 'account.logout', 'session', user.session_id);

    return json({ ok: true }, 200, headers);
  }

  // Current signed-in user
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    return json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    }, 200, headers);
  }

  // Password recovery remains disabled until a verified recovery channel exists.
  if (path === '/api/auth/forgot-password' && request.method === 'POST') {
    return json({
      ok: false,
      message: 'Password/PIN recovery is not enabled yet. Account recovery must be connected to a verified email or phone channel before it can safely change credentials.'
    }, 501, headers);
  }

  // Admin health
  if (path === '/api/admin/health' && request.method === 'GET') {
    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    if (!['owner', 'admin'].includes(user.role)) {
      return json({
        ok: false,
        message: 'Owner or admin access required.'
      }, 403, headers);
    }

    return json({
      ok: true,
      role: user.role,
      database: 'connected'
    }, 200, headers);
  }

  // Subscription access
  if (path === '/api/subscription/access' && request.method === 'GET') {
    const user = await getUser(request, env.DB);

    if (!user) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    if (user.role === 'owner') {
      return json({
        ok: true,
        role: user.role,
        mode: 'owner_exempt',
        allowed: true,
        source: 'server'
      }, 200, headers);
    }

    try {
      const row = await env.DB.prepare(`
        SELECT mode,expires_at,reason
        FROM gpc_customer_plan_access
        WHERE user_id=?
        LIMIT 1
      `).bind(user.id).first();

      const active = !!(
        row &&
        row.expires_at &&
        Date.parse(row.expires_at) > Date.now()
      );

      const mode = active ? row.mode : null;

      return json({
        ok: true,
        role: user.role,
        mode,
        allowed: mode !== 'lock',
        expires_at: active ? row.expires_at : null,
        source: 'server',
        rule: mode === 'grant_free'
          ? 'temporary_free_access'
          : mode === 'lock'
            ? 'temporary_lock'
            : 'normal_plan_rules'
      }, 200, headers);

    } catch {
      return json({
        ok: false,
        message: 'Customer access migration is not applied. Temporary access status cannot be verified.'
      }, 503, headers);
    }
  }

  // Owner-only customer access controls
  if (
    path === '/api/owner/customer-access' &&
    ['GET', 'POST'].includes(request.method)
  ) {
    const actor = await getUser(request, env.DB);

    if (!actor) {
      return json({
        ok: false,
        message: 'Sign-in required.'
      }, 401, headers);
    }

    if (actor.role !== 'owner') {
      return json({
        ok: false,
        message: 'Platform owner permission is required for customer plan controls.'
      }, 403, headers);
    }

    if (request.method === 'GET') {
      const q = String(url.searchParams.get('q') || '')
        .trim()
        .slice(0, 160);

      if (q.length < 2) {
        return json({
          ok: false,
          message: 'Search with at least 2 characters.'
        }, 400, headers);
      }

      const like = '%' + q + '%';

      let rows;

      try {
        rows = await env.DB.prepare(`
          SELECT
            u.id,u.name,u.email,u.phone,u.role,u.status,
            a.mode AS access_mode,
            a.expires_at,
            a.reason AS access_reason
          FROM gpc_users u
          LEFT JOIN gpc_customer_plan_access a ON a.user_id=u.id
          WHERE u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?
          ORDER BY u.created_at DESC
          LIMIT 50
        `).bind(like, like, like).all();

      } catch {
        return json({
          ok: false,
          message: 'Customer access migration is not applied yet. Apply migrations/0002_customer_plan_access.sql first.'
        }, 503, headers);
      }

      const now = Date.now();

      const users = (rows.results || []).map(row => {
        const active = row.access_mode &&
          row.expires_at &&
          Date.parse(row.expires_at) > now;

        return {
          id: row.id,
          name: row.name,
          email: row.email,
          phone: row.phone,
          role: row.role,
          status: row.status,
          access_override: active
            ? {
                mode: row.access_mode,
                expires_at: row.expires_at,
                reason: row.access_reason
              }
            : null
        };
      });

      return json({ ok: true, users }, 200, headers);
    }

    const data = await bodyJson(request);

    if (!data) {
      return json({
        ok: false,
        message: 'Invalid JSON body.'
      }, 400, headers);
    }

    const targetId = String(data.user_id || '').trim();
    const mode = String(data.mode || '');
    const days = Number(data.duration_days);
    const reason = String(data.reason || '').trim().slice(0, 300);

    if (
      !targetId ||
      !['grant_free', 'lock', 'clear'].includes(mode) ||
      reason.length < 5
    ) {
      return json({
        ok: false,
        message: 'Choose a customer, a valid action, and a reason of at least 5 characters.'
      }, 400, headers);
    }

    if (
      mode !== 'clear' &&
      (!Number.isInteger(days) || days < 1 || days > 365)
    ) {
      return json({
        ok: false,
        message: 'Duration must be a whole number between 1 and 365 days.'
      }, 400, headers);
    }

    const target = await env.DB.prepare(
      'SELECT id,name,role FROM gpc_users WHERE id=? LIMIT 1'
    ).bind(targetId).first();

    if (!target) {
      return json({
        ok: false,
        message: 'Customer account not found.'
      }, 404, headers);
    }

    if (target.role === 'owner') {
      return json({
        ok: false,
        message: 'Owner account access cannot be changed using customer plan controls.'
      }, 400, headers);
    }

    try {
      if (mode === 'clear') {
        await env.DB.prepare(
          'DELETE FROM gpc_customer_plan_access WHERE user_id=?'
        ).bind(targetId).run();

      } else {
        const expires = new Date(
          Date.now() + days * 24 * 60 * 60 * 1000
        ).toISOString();

        await env.DB.prepare(`
          INSERT INTO gpc_customer_plan_access
          (user_id,mode,expires_at,reason,set_by_user_id,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET
            mode=excluded.mode,
            expires_at=excluded.expires_at,
            reason=excluded.reason,
            set_by_user_id=excluded.set_by_user_id,
            updated_at=excluded.updated_at
        `).bind(
          targetId,
          mode,
          expires,
          reason,
          actor.id,
          nowIso(),
          nowIso()
        ).run();
      }

      await audit(
        env.DB,
        actor.id,
        'customer.plan_access.' + mode,
        'user',
        targetId,
        {
          reason,
          duration_days: mode === 'clear' ? null : days,
          expires_at: mode === 'clear'
            ? null
            : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        }
      );

    } catch {
      return json({
        ok: false,
        message: 'Could not save the access override. Confirm the customer plan access migration was applied.'
      }, 503, headers);
    }

    return json({
      ok: true,
      message: mode === 'clear'
        ? 'Temporary override removed. Normal plan rules now apply.'
        : (mode === 'grant_free'
            ? 'Free-plan access granted'
            : 'Temporary POS access restriction applied') +
          ' for ' + days + ' days. The override expires automatically; normal plan rules then apply.',
      user_id: targetId,
      mode,
      expires_at: mode === 'clear'
        ? null
        : new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    }, 200, headers);
  }

  return json({
    ok: false,
    message: 'API endpoint not implemented yet.'
  }, 404, headers);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      const errorId = crypto.randomUUID();
      console.error('GODIA PRIME API ERROR', {
        errorId,
        path: new URL(request.url).pathname,
        method: request.method,
        errorName: error?.name || 'UnknownError',
        errorMessage: String(error?.message || 'Unknown error')
      });
      return json({
        ok: false,
        message: 'Unexpected server error. Check Worker logs.',
        errorId
      }, 500, cors(request, env));
    }
  }
};
