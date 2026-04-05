import { Client, ID, Messaging } from 'node-appwrite'; // <-- Added ID here

export default async ({ req, res, log, error }) => {
  // req.body contains the newly created restaurant document
  const newRestaurant = req.body;

  const client = new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(process.env.APPWRITE_API_KEY);

  const messaging = new Messaging(client);

  try {
    // Send a message to the 'new_plates' topic
    await messaging.createPush(
      ID.unique(), // <--- THE FIX! This generates a valid, random ID
      `New Spot Alert: ${newRestaurant.name} 🇯🇲`, // The notification title
      `A new hidden plate just dropped. Check it out before the crowd finds out!`, // The body
      ['new_plates'] // The topic we created earlier
    );

    log(`Successfully sent notification for ${newRestaurant.name}`);
    return res.send('Notification sent!');
  } catch (err) {
    error(`Failed to send notification: ${err.message}`);
    return res.send('Failed');
  }
};
