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

  const { userId, userIds, title, body, type = 'general', data = {} } = payload;

  if (!title || !body) {
    error('Missing required fields: title, body');
    return res.json({ success: false, error: 'title and body are required' }, 400);
  }

  if (!userId && !userIds && userId !== 'all') {
    error('Missing target: provide userId, userIds array, or userId="all"');
    return res.json({ success: false, error: 'Provide userId, userIds, or userId="all"' }, 400);
  }

  // ── Step 1: Resolve target user IDs ──────────────────────────────────────
  let targetUserIds = [];

  if (userId === 'all') {
    // Broadcast — get all unique userIds from push_tokens
    log('📢 Broadcasting to all users');
    const allTokens = await databases.listDocuments(
      process.env.DATABASE_ID,
      process.env.PUSH_TOKENS_COLLECTION_ID,
      [Query.limit(500)]
    );
    targetUserIds = [...new Set(allTokens.documents.map((d) => d.userId))];
    log(`Found ${targetUserIds.length} unique users to notify`);
  } else if (Array.isArray(userIds)) {
    // Multiple specific users
    log(`📨 Sending to ${userIds.length} specific users`);
    targetUserIds = userIds;
  } else {
    // Single user
    log(`📬 Sending to single user: ${userId}`);
    targetUserIds = [userId];
  }

  // ── Step 2: Save notification for each user ───────────────────────────────
  log('💾 Saving notifications to database...');
  await Promise.all(
    targetUserIds.map((uid) =>
      databases.createDocument(
        process.env.DATABASE_ID,
        process.env.NOTIFICATIONS_COLLECTION_ID,
        ID.unique(),
        {
          userId: uid,
          title,
          body,
          type,
          data: JSON.stringify(data),
          isRead: false,
          createdAt: new Date().toISOString(),
        }
      )
    )
  );
  log(`✅ Saved ${targetUserIds.length} notification(s) to database`);

  // ── Step 3: Get push tokens for all target users ──────────────────────────
  let tokens;
  try {
    if (userId === 'all') {
      tokens = await databases.listDocuments(
        process.env.DATABASE_ID,
        process.env.PUSH_TOKENS_COLLECTION_ID,
        [Query.limit(500)]
      );
    } else {
      tokens = await databases.listDocuments(
        process.env.DATABASE_ID,
        process.env.PUSH_TOKENS_COLLECTION_ID,
        [Query.equal('userId', targetUserIds)]
      );
    }
    log(`📱 Found ${tokens.total} push token(s)`);
  } catch (err) {
    error('Failed to fetch push tokens: ' + err.message);
    return res.json({ success: false, error: err.message }, 500);
  }

  if (tokens.total === 0) {
    log('⚠️ No push tokens found — notifications saved but not pushed');
    return res.json({ success: true, pushed: false, reason: 'No tokens found' });
  }

  // ── Step 4: Send via Expo Push API ────────────────────────────────────────
  const messages = tokens.documents.map((doc) => ({
    to: doc.token,
    title,
    body,
    data: { type, ...data },
    sound: 'default',
    priority: 'high',
  }));

  // Expo allows max 100 messages per request — chunk if needed
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  log(`📤 Sending ${messages.length} push(es) in ${chunks.length} chunk(s)`);

  try {
    const results = await Promise.all(
      chunks.map((chunk) =>
        fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(chunk),
        }).then((r) => r.json())
      )
    );

    log('✅ Expo push response: ' + JSON.stringify(results));

    return res.json({
      success: true,
      pushed: true,
      notified: targetUserIds.length,
      tokens: tokens.total,
      results,
    });
  } catch (err) {
    error('Failed to send push notification: ' + err.message);
    return res.json({ success: false, error: err.message }, 500);
  }
};
