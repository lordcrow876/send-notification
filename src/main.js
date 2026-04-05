import { Client, Databases, ID, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {

  // ── Init Appwrite client ──────────────────────────────────────────────────
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const databases = new Databases(client);

  // ── Parse request body ────────────────────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(req.body);
  } catch (err) {
    error('Invalid JSON body');
    return res.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { userId, title, body, type = 'general', data = {} } = payload;

  if (!userId || !title || !body) {
    error('Missing required fields: userId, title, body');
    return res.json(
      { success: false, error: 'userId, title and body are required' },
      400
    );
  }

  log(`Sending notification to user: ${userId}`);

  // ── Step 1: Save to notifications collection ──────────────────────────────
  try {
    await databases.createDocument(
      process.env.DATABASE_ID,
      process.env.NOTIFICATIONS_COLLECTION_ID,
      ID.unique(),
      {
        userId,
        title,
        body,
        type,
        data: JSON.stringify(data),
        isRead: false,
        createdAt: new Date().toISOString(),
      }
    );
    log('✅ Notification saved to database');
  } catch (err) {
    error('Failed to save notification to database: ' + err.message);
    return res.json({ success: false, error: err.message }, 500);
  }

  // ── Step 2: Get user push tokens ──────────────────────────────────────────
  let tokens;
  try {
    tokens = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION_ID,
      [Query.equal('userId', userId)]
    );
    log(`Found ${tokens.total} push token(s) for user`);
  } catch (err) {
    error('Failed to fetch push tokens: ' + err.message);
    return res.json({ success: false, error: err.message }, 500);
  }

  if (tokens.total === 0) {
    log('No push tokens found — notification saved but not pushed');
    return res.json({ success: true, pushed: false, reason: 'No tokens found' });
  }

  // ── Step 3: Send via Expo Push API ────────────────────────────────────────
  const messages = tokens.documents.map((doc) => ({
    to: doc.token,
    title,
    body,
    data: { type, ...data },
    sound: 'default',
    priority: 'high',
  }));

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const result = await response.json();
    log('Expo push response: ' + JSON.stringify(result));

    return res.json({ success: true, pushed: true, tokens: tokens.total, result });
  } catch (err) {
    error('Failed to send push notification: ' + err.message);
    return res.json({ success: false, error: err.message }, 500);
  }
};
