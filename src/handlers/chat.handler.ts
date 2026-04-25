// webhook/handlers/chat.handler.ts

export async function handleChatMessage({
  mastra,
  phone,
  text,
  sendMessage,
}: {
  mastra: any;
  phone: string;
  text: string;
  sendMessage: (to: string, msg: string) => Promise<void>;
}) {
  try {
    const agent = mastra.getAgent('engagementAgent');

    const response = await agent.generate(
      [{ role: 'user', content: text }],
      {
        memory: {
          thread: `thread_${phone}`,
          resource: phone,
        },
      }
    );

    const reply =
      response?.text?.trim() ||
      "Sorry, I couldn't process that. Please try again.";

    await sendMessage(phone, reply);
  } catch (error) {
    console.error('❌ Chat handler error:', error);

    await sendMessage(
      phone,
      "👋 Thanks for reaching out. We're experiencing a delay right now. Please try again shortly."
    );
  }
}
