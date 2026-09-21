export default async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.ANTHROPIC_MODEL;
  if (!apiKey || !model) {
    return Response.json({ error: 'Missing ANTHROPIC_API_KEY or ANTHROPIC_MODEL.' }, { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const system = typeof body.system === 'string' ? body.system.slice(0, 12000) : '';
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  if (!system || !messages.length) return Response.json({ error: 'Missing system or messages.' }, { status: 400 });

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        messages: messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })),
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) return Response.json({ error: data?.error?.message || 'Anthropic request failed.' }, { status: upstream.status });
    const text = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
    return Response.json({ text });
  } catch (err) {
    return Response.json({ error: err.message || 'AI proxy failed.' }, { status: 500 });
  }
};
