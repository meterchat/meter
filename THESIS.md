# METER THESIS

Every vibebuilder ships an AI app in a weekend. None of them can charge for it on Monday.

Cursor hit $1B ARR faster than any SaaS company in history. 41% of all code is now written by AI. Anyone who can chat can code. But AI billing is stuck in the subscription era. Developers pay flat monthly fees for each model, hit hidden rate limits when they need deep reasoning, and have zero visibility into what their fragmented AI stack actually costs. End users get it worse — they either overpay with a $20/month subscription or get cut off mid-thought.

Intelligence is a utility. It should be metered like compute, routed like traffic, and billed like usage.

**Meter is the billing layer for AI.**

Drop in one SDK — your app gets multi-model AI chat, a live cost meter, and automatic billing. Model routing across every frontier provider. Per-message receipts. End-user card collection and auto-charge. Your users pay per thought. You keep the margin. Three lines of code, monetized by lunch.

```jsx
<MeterProvider apiKey="mk_live_xxx">
  <MeterChat userId={session.user.id} />
</MeterProvider>
```

No monthly platform fees. No minimum commitments. Meter makes money when your app makes money.

Two layers. One headless API for developers who build custom UI — call `meter.chat()`, get a response and a cost. One set of pre-built React components for developers who want to ship fast — chat box, model picker, cost counter, card form. The Stripe API and Stripe Elements of AI.

Experience it live at **meter.chat** — a full AI workspace built entirely on the Meter SDK. Every frontier model on one postpaid tab. Debate decisions across models. Commit the ones that matter. Your thinking compounds like code.

Vibecoding solved building apps. Meter solves billing them.

**Build on Meter. Pay per thought.**
