const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error('Set DEEPSEEK_API_KEY first'); process.exit(1); }

const res = await fetch('https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [{ role: 'user', content: '用五个字回复：你好' }],
    stream: true,
  }),
});
console.log('HTTP status:', res.status);
const decoder = new TextDecoder();
for await (const chunk of res.body) process.stdout.write(decoder.decode(chunk, { stream: true }));
