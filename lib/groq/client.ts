/**
 * Groq AI integration — server-only
 * Used for metadata suggestions (titles, descriptions, tags, categories)
 * Docs: https://console.groq.com/docs
 */

import Groq from "groq-sdk";

let groqClient: Groq | null = null;

export function getGroqClient(): Groq | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!groqClient) {
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

export interface SuggestMetadataParams {
  title?: string;
  fileName?: string;
  category?: string;
  existingTags?: string;
}

export interface SuggestedMetadata {
  title: string;
  description: string;
  tags: string[];
  category: string;
  reasoning?: string;
}

export async function suggestVideoMetadata(
  params: SuggestMetadataParams
): Promise<SuggestedMetadata> {
  const client = getGroqClient();
  if (!client) {
    throw new Error("Groq not configured — missing GROQ_API_KEY");
  }

  // Use a model that exists per current docs — llama-3.1-8b-instant or similar
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

  const prompt = `You are a metadata assistant for an adult video platform that hosts only legally owned or licensed content by the platform owner. 
The user is an administrator who uploaded a video file named "${params.fileName || "untitled"}" with current title "${params.title || ""}" in category "${params.category || "Mature"}" and tags "${params.existingTags || ""}".

Generate:
- A concise, non-clickbait title (max 60 chars)
- A tasteful description (max 200 chars) that accurately describes the editorial nature without explicit pornographic detail
- 3-5 relevant tags from: mature, amateur, pov, lesbian, kinky, couples, boudoir, romantic, solo, roleplay, massage, 4k, hd, featured, editorial
- A category from: Mature, Amateur, POV, Lesbian, Kinky, Mature 18+, Couples, Boudoir, Romantic, Solo, Roleplay, Massage

Important:
- Do NOT invent performer names, ages, or unverified facts
- Do NOT generate explicit pornographic descriptions
- Keep it professional and suitable for SEO
- Return JSON only with keys: title, description, tags (array), category

Example JSON:
{"title":"Evening in Velvet","description":"An elegant, slow-paced portrait captured in soft cinematic light.","tags":["mature","boudoir","4k"],"category":"Boudoir"}
`;

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.7,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Groq returned empty content");

  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || params.title || "Untitled",
      description: parsed.description || "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      category: parsed.category || params.category || "Mature",
      reasoning: "AI-generated suggestion, requires human review",
    };
  } catch (e) {
    throw new Error(`Failed to parse Groq JSON: ${content}`);
  }
}
