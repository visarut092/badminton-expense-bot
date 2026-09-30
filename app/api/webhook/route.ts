import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/src/lib/supabase";

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
      // รองรับเฉพาะข้อความ Text
      if (
        event.type !== "message" ||
        event.message?.type !== "text" ||
        !event.replyToken
      ) {
        continue;
      }

      const text = event.message.text.trim();

      // ถ้าไม่ได้ขึ้นต้นด้วย "ผู้ช่วย" ให้เงียบ
      if (!text.startsWith("ผู้ช่วย")) {
        continue;
      }

      const command = text.replace(/^ผู้ช่วย\s*/, "").trim();

      // คำสั่ง: จองแบด
      if (command.startsWith("จองแบด")) {
        const bookingText = command
          .replace(/^จองแบด\s*/, "")
          .trim();

        /*
         * ตัวอย่าง:
         * ผู้ช่วย จองแบด
         * 5/10 19:00-21:00 สนาม ABC
         */

        const match = bookingText.match(
          /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.+)$/,
        );

        if (!match) {
          await replyToLine(
            event.replyToken,
            "❌ รูปแบบไม่ถูกต้องครับ\n\nตัวอย่าง:\nผู้ช่วย จองแบด\n5/10 19:00-21:00 สนาม ABC",
          );

          continue;
        }

        const [, day, month, startTime, endTime, venue] = match;

        const currentYear = new Date().getFullYear();

        const playDate = `${currentYear}-${month.padStart(
          2,
          "0",
        )}-${day.padStart(2, "0")}`;

        const groupId = event.source?.groupId;
        const userId = event.source?.userId;

        // คำสั่งนี้ควรใช้ใน Group เท่านั้น
        if (!groupId) {
          await replyToLine(
            event.replyToken,
            "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ครับ",
          );

          continue;
        }

        const { data, error } = await supabase
          .from("badminton_sessions")
          .insert({
            group_id: groupId,
            play_date: playDate,
            start_time: startTime,
            end_time: endTime,
            venue,
            status: "open",
            created_by: userId ?? null,
          })
          .select()
          .single();

        if (error) {
          console.error("Supabase insert error:", error);

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถบันทึกตารางตีแบดได้ครับ",
          );

          continue;
        }

        console.log("Created badminton session:", data);

        await replyToLine(
          event.replyToken,
          `🏸 เพิ่มตารางตีแบดเรียบร้อยครับ

📅 วันที่: ${day}/${month}/${currentYear}
⏰ เวลา: ${startTime} - ${endTime}
📍 สนาม: ${venue}

ขั้นตอนต่อไปเราจะเพิ่มปุ่มให้สมาชิกกดเข้าร่วมครับ`,
        );

        continue;
      }

      // คำสั่งผู้ช่วยที่ยังไม่รู้จัก
      await replyToLine(
        event.replyToken,
        `❓ ยังไม่รู้จักคำสั่ง "${command}" ครับ`,
      );
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

async function replyToLine(replyToken: string, text: string) {
  const response = await fetch(
    "https://api.line.me/v2/bot/message/reply",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [
          {
            type: "text",
            text,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error("LINE Reply API error:", errorText);
  }
}
