// Simulates a seller chatting with the bot by POSTing WhatsApp-style webhook payloads.
// Run the server first (without WA_ACCESS_TOKEN it runs in dry-run mode), then: npm run simulate
const base = process.env.BASE_URL || 'http://localhost:3000';
const phone = process.env.SIM_PHONE || '919876543210';
let n = 0;

const wrap = (message) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: { messages: [{ from: phone, id: `sim-${Date.now()}-${n++}`, ...message }] } }] }],
});

const text = (body) => wrap({ type: 'text', text: { body } });
const image = (id) => wrap({ type: 'image', image: { id } });
const button = (id) => wrap({ type: 'interactive', interactive: { button_reply: { id, title: id } } });

async function send(payload, label) {
  const res = await fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log(`\n>>> ${label} (HTTP ${res.status})`);
  await new Promise((r) => setTimeout(r, 400)); // let the bot reply
}

await send(text('Hi'), 'user: Hi');
await send(text('I want to sell something'), 'user: I want to sell something');
// two photos sent back-to-back, to prove concurrent messages are handled safely
await Promise.all([send(image('media-1'), 'user: [photo 1]'), send(image('media-2'), 'user: [photo 2]')]);
await send(text('done'), 'user: done');
await send(text('iPhone 12 128GB, blue'), 'user: iPhone 12 128GB, blue');
await send(text('₹28,000'), 'user: ₹28,000');
await send(text('Used for 2 years, battery health 86%, small scratch on the back. Box and charger included.'), 'user: description');
await send(button('confirm_yes'), 'user: [Publish button]');
await send(text('my ads'), 'user: my ads');

const ads = await (await fetch(`${base}/api/ads`)).json();
console.log('\n=== /api/ads ===');
console.log(JSON.stringify(ads, null, 2));
