import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GROQ_MODEL,
  resolveGroqModel,
  withGroqModelFallback,
} from "@/lib/groq/client";

function modelNotFoundError(model: string) {
  const error = new Error(
    `404 {"error":{"message":"The model ${model} does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}`
  );
  return Object.assign(error, {
    status: 404,
    error: {
      message: `The model \`${model}\` does not exist or you do not have access to it.`,
      type: "invalid_request_error",
      code: "model_not_found",
    },
  });
}

describe("Groq model configuration", () => {
  it("defaults to Groq's current replacement model", () => {
    expect(resolveGroqModel(undefined)).toBe("openai/gpt-oss-20b");
    expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-20b");
  });

  it("migrates an explicitly configured retired Llama model", () => {
    expect(resolveGroqModel("llama-3.1-8b-instant")).toBe(DEFAULT_GROQ_MODEL);
  });

  it("uses a custom model when one is configured", () => {
    expect(resolveGroqModel(" my-custom-model ")).toBe("my-custom-model");
  });

  it("retries a model_not_found error with the maintained default model", async () => {
    const calls: string[] = [];
    const createCompletion = vi.fn(async (model: string) => {
      calls.push(model);
      if (model === "custom-retired-model") throw modelNotFoundError(model);
      return { model, content: "ok" };
    });

    const result = await withGroqModelFallback("custom-retired-model", createCompletion);

    expect(calls).toEqual(["custom-retired-model", DEFAULT_GROQ_MODEL]);
    expect(result).toEqual({ model: DEFAULT_GROQ_MODEL, content: "ok" });
  });

  it("does not retry errors unrelated to a missing model", async () => {
    const unauthorized = Object.assign(new Error("Invalid API key"), { status: 401 });
    const createCompletion = vi.fn(async () => {
      throw unauthorized;
    });

    await expect(withGroqModelFallback("custom-model", createCompletion)).rejects.toBe(unauthorized);
    expect(createCompletion).toHaveBeenCalledTimes(1);
  });

  it("returns an actionable error when the replacement is also unavailable", async () => {
    const createCompletion = vi.fn(async (model: string) => {
      throw modelNotFoundError(model);
    });

    await expect(withGroqModelFallback("custom-retired-model", createCompletion)).rejects.toThrow(
      /Set GROQ_MODEL to an active model enabled for your Groq account/
    );
    expect(createCompletion).toHaveBeenCalledTimes(2);
  });
});
