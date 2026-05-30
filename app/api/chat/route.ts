import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import type { ResponseInput } from "openai/resources/responses/responses";
import { NextResponse } from "next/server";

const OPENAI_MODEL = "gpt-4o-mini";

export const runtime = "nodejs";

type UploadedImage = {
  dataUrl: string;
  name?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  image?: UploadedImage;
};

const promptPath = path.join(
  process.cwd(),
  "prompts",
  "quotecatch-system-prompt.txt",
);

async function getSystemPrompt() {
  return readFile(promptPath, "utf8");
}

function toResponsesInput(messages: ChatMessage[]): ResponseInput {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.content,
      };
    }

    const content: Array<
      | { type: "input_text"; text: string }
      | { type: "input_image"; image_url: string; detail: "auto" }
    > = [
      {
        type: "input_text",
        text: message.content || "Please review the attached photo.",
      },
    ];

    if (message.image?.dataUrl) {
      content.push({
        type: "input_image",
        image_url: message.image.dataUrl,
        detail: "auto",
      });
    }

    return {
      role: "user",
      content,
    };
  });
}

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not configured on the server." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as { messages?: ChatMessage[] };
    const messages = body.messages ?? [];

    if (!messages.length) {
      return NextResponse.json(
        { error: "At least one message is required." },
        { status: 400 },
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
    });
    const systemPrompt = await getSystemPrompt();

    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions: systemPrompt,
      input: toResponsesInput(messages),
    });

    return NextResponse.json({
      reply: response.output_text,
      model: OPENAI_MODEL,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "QuoteCatch could not generate a reply. Please try again." },
      { status: 500 },
    );
  }
}
