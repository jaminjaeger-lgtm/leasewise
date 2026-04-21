export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  const origin = req.headers.origin || 'https://leasewise.rentals';

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'LeaseWise Full Report',
        'line_items[0][price_data][product_data][description]': 'Complete document analysis with all flags and findings',
        'line_items[0][price_data][unit_amount]': '400',
        'line_items[0][quantity]': '1',
        'mode': 'payment',
        'success_url': `${origin}/?unlocked=true`,
        'cancel_url': `${origin}/`,
      }),
    });

    const session = await response.json();

    if (!response.ok) {
      throw new Error(session.error?.message || 'Stripe error');
    }

    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Checkout error' });
  }
}
