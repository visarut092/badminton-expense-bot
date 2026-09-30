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

      // รองรับการกดปุ่ม Attendance
      if (
        event.type === "postback" &&
        event.postback?.data &&
        event.source?.groupId &&
        event.source?.userId
      ) {
        const postbackData = event.postback.data;

        const match = postbackData.match(
          /^attendance:(joined|maybe|declined):(\d+)$/,
        );

        if (!match) {
          continue;
        }

        const [, responseStatus, sessionId] = match;

        const userId = event.source.userId;
        const groupId = event.source.groupId;

        // ตรวจสอบสถานะของรอบตีแบดก่อนบันทึก Attendance
        const { data: session, error: sessionError } =
          await supabase
            .from("badminton_sessions")
            .select("id, status")
            .eq("id", Number(sessionId))
            .eq("group_id", groupId)
            .maybeSingle();

        if (sessionError) {
          console.error(
            "Supabase get session for attendance error:",
            sessionError,
          );

          continue;
        }

        // ถ้ารอบถูกปิดแล้ว จะไม่สามารถเปลี่ยน Attendance ได้
        if (!session || session.status !== "open") {
          console.log(
            `Attendance ignored: session ${sessionId} is closed or not found`,
          );

          await replyToLine(
            event.replyToken,
            "🔒 รอบนี้ปิดไปแล้วครับ ไม่สามารถเปลี่ยนการเข้าร่วมได้",
          );

          continue;
        }

        const userName = await getLineDisplayName(
          groupId,
          userId,
        );

        console.log("Attendance response:", {
          groupId,
          userId,
          userName,
          sessionId,
          responseStatus,
        });

        const { error } = await supabase
          .from("badminton_participants")
          .upsert(
            {
              session_id: Number(sessionId),
              user_id: userId,
              user_name: userName,
              response_status: responseStatus,
              responded_at: new Date().toISOString(),
            },
            {
              onConflict: "session_id,user_id",
            },
          );

        if (error) {
          console.error(
            "Supabase participant upsert error:",
            error,
          );

          continue;
        }

        continue;
      }

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
      // คำสั่ง: ดูรายชื่อ
      if (command === "ดูรายชื่อ") {
        const groupId = event.source?.groupId;

        if (!groupId) {
          await replyToLine(
            event.replyToken,
            "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ครับ",
          );
          continue;
        }

        // หาตารางล่าสุดของกลุ่มที่ยังเปิดอยู่
        const { data: session, error: sessionError } = await supabase
          .from("badminton_sessions")
          .select("*")
          .eq("group_id", groupId)
          .eq("status", "open")
          .order("play_date", { ascending: false })
          .order("start_time", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sessionError) {
          console.error(
            "Supabase get session error:",
            sessionError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถดึงข้อมูลตารางตีแบดได้ครับ",
          );

          continue;
        }

        if (!session) {
          await replyToLine(
            event.replyToken,
            "❌ ยังไม่มีตารางตีแบดที่เปิดอยู่ครับ",
          );

          continue;
        }

        // ดึงรายชื่อสมาชิกทั้งหมดของตารางนี้
        const { data: participants, error: participantError } =
          await supabase
            .from("badminton_participants")
            .select("user_name, response_status")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true });

        if (participantError) {
          console.error(
            "Supabase get participants error:",
            participantError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถดึงรายชื่อผู้เข้าร่วมได้ครับ",
          );

          continue;
        }

        const joined = (participants ?? []).filter(
          (item) => item.response_status === "joined",
        );

        const maybe = (participants ?? []).filter(
          (item) => item.response_status === "maybe",
        );

        const declined = (participants ?? []).filter(
          (item) => item.response_status === "declined",
        );

        const joinedText =
          joined.length > 0
            ? joined
                .map((item) => `• ${item.user_name ?? "ไม่ทราบชื่อ"}`)
                .join("\n")
            : "";

        const maybeText =
          maybe.length > 0
            ? maybe
                .map((item) => `• ${item.user_name ?? "ไม่ทราบชื่อ"}`)
                .join("\n")
            : "";

        const declinedText =
          declined.length > 0
            ? declined
                .map((item) => `• ${item.user_name ?? "ไม่ทราบชื่อ"}`)
                .join("\n")
            : "";

        const message = [
          "🏸 รายชื่อก๊วนแบด",
          "",
          `📅 ${formatDateForDisplay(session.play_date)}`,
          `⏰ ${session.start_time.slice(0, 5)}${
            session.end_time
              ? ` - ${session.end_time.slice(0, 5)}`
              : ""
          }`,
          `📍 ${session.venue ?? "-"}`,
          "",
          `🏸 เข้าร่วม ${joined.length} คน`,
          joinedText,
          "",
          `❓ ยังไม่แน่ใจ ${maybe.length} คน`,
          maybeText,
          "",
          `❌ ไม่ไป ${declined.length} คน`,
          declinedText,
        ]
          .filter((line, index, array) => {
            // ลบเฉพาะบรรทัดว่างซ้ำ ๆ
            return !(line === "" && array[index - 1] === "");
          })
          .join("\n");

        await replyToLine(event.replyToken, message);

        continue;
      }

      // คำสั่ง: เพิ่มค่าใช้จ่าย

      if (command.startsWith("เพิ่มค่าใช้จ่าย")) {
        const expenseText = command
          .replace(/^เพิ่มค่าใช้จ่าย\s*/, "")
          .trim();

        const match = expenseText.match(
          /^(\d+(?:\.\d{1,2})?)\s+(.+)$/,
        );

        if (!match) {
          await replyToLine(
            event.replyToken,
            "❌ รูปแบบไม่ถูกต้องครับ\n\nตัวอย่าง:\nผู้ช่วย เพิ่มค่าใช้จ่าย 600 ค่าสนาม",
          );

          continue;
        }

        const [, amountText, description] = match;

        const amount = Number(amountText);

        if (!Number.isFinite(amount) || amount <= 0) {
          await replyToLine(
            event.replyToken,
            "❌ จำนวนเงินต้องมากกว่า 0 บาทครับ",
          );

          continue;
        }

        const groupId = event.source?.groupId;
        const userId = event.source?.userId;

        if (!groupId || !userId) {
          await replyToLine(
            event.replyToken,
            "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ครับ",
          );

          continue;
        }

        // หาตารางตีแบดล่าสุดที่ยังเปิดอยู่
        const { data: session, error: sessionError } =
          await supabase
            .from("badminton_sessions")
            .select("*")
            .eq("group_id", groupId)
            .eq("status", "open")
            .order("play_date", { ascending: false })
            .order("start_time", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (sessionError) {
          console.error(
            "Supabase get session for expense error:",
            sessionError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถตรวจสอบตารางตีแบดได้ครับ",
          );

          continue;
        }

        if (!session) {
          await replyToLine(
            event.replyToken,
            "❌ ยังไม่มีตารางตีแบดที่เปิดอยู่ครับ",
          );

          continue;
        }

        // ดึงชื่อคนที่เพิ่มค่าใช้จ่าย
        const userName = await getLineDisplayName(
          groupId,
          userId,
        );

        // บันทึกค่าใช้จ่าย
        const { error: expenseError } = await supabase
          .from("expenses")
          .insert({
            group_id: groupId,
            user_id: userId,
            user_name: userName,
            description,
            amount,
            session_id: session.id,
          });

        if (expenseError) {
          console.error(
            "Supabase insert expense error:",
            expenseError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถบันทึกค่าใช้จ่ายได้ครับ",
          );

          continue;
        }

        await replyToLine(
          event.replyToken,
          [
            "✅ เพิ่มค่าใช้จ่ายแล้ว",
            "",
            `💰 จำนวน: ${amount.toLocaleString("th-TH")} บาท`,
            `📝 รายการ: ${description}`,
          ].join("\n"),
        );

        continue;
      }

      // คำสั่ง: สรุปค่าใช้จ่าย

      if (command === "สรุปค่าใช้จ่าย") {
        const groupId = event.source?.groupId;

        if (!groupId) {
          await replyToLine(
            event.replyToken,
            "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ครับ",
          );

          continue;
        }

        // หาตารางตีแบดล่าสุดที่ยังเปิดอยู่
        const { data: session, error: sessionError } =
          await supabase
            .from("badminton_sessions")
            .select("*")
            .eq("group_id", groupId)
            .eq("status", "open")
            .order("play_date", { ascending: false })
            .order("start_time", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (sessionError) {
          console.error(
            "Supabase get session for summary error:",
            sessionError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถตรวจสอบตารางตีแบดได้ครับ",
          );

          continue;
        }

        if (!session) {
          await replyToLine(
            event.replyToken,
            "❌ ยังไม่มีตารางตีแบดที่เปิดอยู่ครับ",
          );

          continue;
        }

        // ดึงค่าใช้จ่ายของ session นี้
        const { data: expenses, error: expenseError } =
          await supabase
            .from("expenses")
            .select("description, amount")
            .eq("session_id", session.id)
            .order("created_at", { ascending: true });

        if (expenseError) {
          console.error(
            "Supabase get expenses error:",
            expenseError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถดึงข้อมูลค่าใช้จ่ายได้ครับ",
          );

          continue;
        }

        if (!expenses || expenses.length === 0) {
          await replyToLine(
            event.replyToken,
            "❌ รอบนี้ยังไม่มีค่าใช้จ่ายครับ",
          );

          continue;
        }

        // ดึงเฉพาะคนที่กดเข้าร่วม
        const { data: participants, error: participantError } =
          await supabase
            .from("badminton_participants")
            .select("user_id, user_name, response_status")
            .eq("session_id", session.id)
            .eq("response_status", "joined")
            .order("created_at", { ascending: true });

        if (participantError) {
          console.error(
            "Supabase get joined participants error:",
            participantError,
          );

          await replyToLine(
            event.replyToken,
            "❌ ไม่สามารถดึงรายชื่อผู้เข้าร่วมได้ครับ",
          );

          continue;
        }

        const joinedCount = participants?.length ?? 0;

        if (joinedCount === 0) {
          await replyToLine(
            event.replyToken,
            "❌ ยังไม่มีคนกดเข้าร่วมครับ",
          );

          continue;
        }

        // รวมค่าใช้จ่ายทั้งหมด
        const totalAmount = expenses.reduce(
          (total, expense) => total + Number(expense.amount),
          0,
        );

        // หารค่าใช้จ่ายต่อคน
        const amountPerPerson = totalAmount / joinedCount;

        const expenseLines = expenses.map(
          (expense) =>
            `• ${expense.description} ${Number(
              expense.amount,
            ).toLocaleString("th-TH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })} บาท`,
        );

        const participantLines = (participants ?? []).map(
          (participant) =>
            `• ${participant.user_name ?? "ไม่ทราบชื่อ"} — ${amountPerPerson.toLocaleString(
              "th-TH",
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              },
            )} บาท`,
        );

        const message = [
          "💰 สรุปค่าใช้จ่าย",
          "",
          `📅 ${formatDateForDisplay(session.play_date)}`,
          `⏰ ${session.start_time.slice(0, 5)}${
            session.end_time
              ? ` - ${session.end_time.slice(0, 5)}`
              : ""
          }`,
          `📍 ${session.venue ?? "-"}`,
          "",
          "📝 รายการค่าใช้จ่าย",
          ...expenseLines,
          "",
          `💰 รวมทั้งหมด ${totalAmount.toLocaleString("th-TH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} บาท`,
          "",
          `🏸 ผู้เข้าร่วม ${joinedCount} คน`,
          `💵 คนละ ${amountPerPerson.toLocaleString("th-TH", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} บาท`,
          "",
          "👥 รายชื่อผู้เข้าร่วม",
          ...participantLines,
          "",
          ​"พร้อมเพย์ : 0973544449",
          "🔒 ปิดรอบเรียบร้อยแล้ว",
        ].join("\n");

        // ปิดรอบตีแบด
        const { error: closeSessionError } = await supabase
          .from("badminton_sessions")
          .update({
            status: "closed",
          })
          .eq("id", session.id);

        if (closeSessionError) {
          console.error(
            "Supabase close session error:",
            closeSessionError,
          );

          await replyToLine(
            event.replyToken,
            "❌ สรุปค่าใช้จ่ายสำเร็จ แต่ไม่สามารถปิดรอบได้ครับ",
          );

          continue;
        }

        await replyToLine(
          event.replyToken,
          message,
        );

        continue;
      }

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

        await replyToLineWithAttendance(
          event.replyToken,
          {
            sessionId: data.id,
            day,
            month,
            year: currentYear,
            startTime,
            endTime,
            venue,
          },
        );

        continue;
      }

      // คำสั่ง: กวนส้นตีน
      if (command === "เลียไข่") {
        const groupId = event.source?.groupId;
        const userId = event.source?.userId;

        if (!groupId || !userId) {
          await replyToLine(
            event.replyToken,
            "❌ คำสั่งนี้ใช้ได้เฉพาะในกลุ่ม LINE ครับ",
          );

          continue;
        }

        const userName = await getLineDisplayName(
          groupId,
          userId,
        );

        await replyToLine(
          event.replyToken,
          [
            `คุณ ${userName ?? "ไม่ทราบชื่อ"} กรุณาจ่ายเงินเพิ่ม 100 บาท`,
            "พร้อมเพย์ : 0897749968",
            "ไม่จ่ายไข่เล็ก",
          ].join("\n"),
        );

        continue;
      }

      if (command === "เก่งมาก") {
        await replyToLine(
          event.replyToken,
          "ขอบคุณครับ 😎",
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

async function replyToLine(
  replyToken: string,
  text: string,
) {
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

async function replyToLineWithAttendance(
  replyToken: string,
  session: {
    sessionId: number;
    day: string;
    month: string;
    year: number;
    startTime: string;
    endTime: string;
    venue: string;
  },
) {
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
            type: "flex",
            altText: "🏸 ตารางตีแบดใหม่ - กรุณาเลือกการเข้าร่วม",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                spacing: "md",
                contents: [
                  {
                    type: "text",
                    text: "🏸 ตารางตีแบดใหม่",
                    weight: "bold",
                    size: "xl",
                  },
                  {
                    type: "text",
                    text: `📅 ${session.day}/${session.month}/${session.year}`,
                  },
                  {
                    type: "text",
                    text: `⏰ ${session.startTime} - ${session.endTime}`,
                  },
                  {
                    type: "text",
                    text: `📍 ${session.venue}`,
                    wrap: true,
                  },
                  {
                    type: "separator",
                    margin: "md",
                  },
                  {
                    type: "text",
                    text: "ใครไปกดเลือกได้เลยครับ 👇",
                    margin: "md",
                    wrap: true,
                  },
                  {
                    type: "button",
                    style: "primary",
                    action: {
                      type: "postback",
                      label: "🏸 เข้าร่วม",
                      data: `attendance:joined:${session.sessionId}`,
                      displayText: "🏸 เข้าร่วม",
                    },
                  },
                  {
                    type: "button",
                    style: "secondary",
                    action: {
                      type: "postback",
                      label: "❓ ยังไม่แน่ใจ",
                      data: `attendance:maybe:${session.sessionId}`,
                      displayText: "❓ ยังไม่แน่ใจ",
                    },
                  },
                  {
                    type: "button",
                    style: "secondary",
                    action: {
                      type: "postback",
                      label: "❌ ไม่ไป",
                      data: `attendance:declined:${session.sessionId}`,
                      displayText: "❌ ไม่ไป",
                    },
                  },
                ],
              },
            },
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "LINE Attendance Reply API error:",
      errorText,
    );
  }
}

async function getLineDisplayName(
  groupId: string,
  userId: string,
): Promise<string | null> {
  const response = await fetch(
    `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "LINE Group Member Profile API error:",
      errorText,
    );

    return null;
  }

  const profile = await response.json();

  return profile.displayName ?? null;
}

function formatDateForDisplay(date: string) {
  const [year, month, day] = date.split("-");

  return `${day}/${month}/${year}`;
}