import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Webhook is working",
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.log("LINE Webhook:", body);

    const events = body.events ?? [];

    for (const event of events) {
      if (
        event.type === "message" &&
        event.message?.type === "text" &&
        event.replyToken
      ) {
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: `ได้รับข้อความแล้วครับ: ${event.message.text}`,
              },
            ],
          }),
        });
      }
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Webhook error:", error);

    return NextResponse.json(
      {
        success: false,
      },
      { status: 400 },
    );
  }
}