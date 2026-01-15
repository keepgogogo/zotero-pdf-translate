import { getPref, getString, transformPromptWithContext } from "../../utils";
import { TranslateService } from "./base";
import type { TranslateTask } from "../../utils/task";

const translate = <TranslateService["translate"]>async function (data) {
  const apiURL = getPref("zhipuai.endPoint") as string;
  const model = getPref("zhipuai.model") as string;
  const temperature = parseFloat(getPref("zhipuai.temperature") as string);
  const stream = getPref("zhipuai.stream") as boolean;
  const maxTokens = parseInt(getPref("zhipuai.maxTokens") as string) || 4000;

  const refreshHandler = addon.api.getTemporaryRefreshHandler({ task: data });

  function transformContent(
    langFrom: string,
    langTo: string,
    sourceText: string,
  ) {
    return transformPromptWithContext(
      "zhipuai.prompt",
      langFrom,
      langTo,
      sourceText,
      data,
    );
  }

  const requestBody = {
    model: model,
    messages: [
      {
        role: "user",
        content: transformContent(data.langfrom, data.langto, data.raw),
      },
    ],
    temperature: temperature,
    stream: stream,
    max_tokens: maxTokens,
  };

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${data.secret}`,
  };

  const xhr = await Zotero.HTTP.request("POST", apiURL, {
    headers: headers,
    body: JSON.stringify(requestBody),
    responseType: "text",
    requestObserver: (xmlhttp: XMLHttpRequest) => {
      if (stream) {
        let preLength = 0;
        let result = "";
        let buffer = ""; // Buffer to handle partial JSON chunks

        xmlhttp.onprogress = (e: any) => {
          try {
            // Get only the new data since last progress event
            const newResponse = e.target.response.slice(preLength);
            preLength = e.target.response.length;

            // Add to our working buffer
            buffer += newResponse;

            // Process complete data: chunks by splitting on newlines
            const lines = buffer.split("\n");

            // Keep the last line in the buffer as it might be incomplete
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.trim()) continue; // Skip empty lines

              // Remove the "data: " prefix if present
              const dataLine = line.startsWith("data: ") ? line.slice(6) : line;

              if (dataLine.trim() === "[DONE]") continue;

              try {
                const obj = JSON.parse(dataLine);
                if (obj.choices && obj.choices[0] && obj.choices[0].delta) {
                  result += obj.choices[0].delta.content || "";
                }
              } catch (parseError) {
                // Skip invalid JSON - might be a partial chunk
                continue;
              }
            }

            // Clear timeouts caused by stream transfers
            if (e.target.timeout) {
              e.target.timeout = 0;
            }

            // Update the result
            data.result = result.replace(/^\n\n/, "");

            // Refresh UI to show progress
            refreshHandler();
          } catch (error) {
            console.error("Error processing ZhipuAI stream:", error);
          }
        };

        // Also handle the load event to ensure we get the complete text
        xmlhttp.onload = () => {
          data.status = "success";

          // Refresh UI once more to ensure we display the final result
          refreshHandler();
        };
      } else {
        // Non-streaming logic
        xmlhttp.onload = () => {
          try {
            const responseObj = JSON.parse(xmlhttp.responseText);
            const resultContent = responseObj.choices[0]?.message?.content || "";
            data.result = resultContent.replace(/^\n\n/, "");
            data.status = "success";
          } catch (error) {
            data.result = getString("status-translating");
            data.status = "fail";
            throw `Failed to parse response: ${error}`;
          }

          // Trigger UI updates after receiving the full response
          refreshHandler();
        };
      }
    },
  });

  if (xhr?.status !== 200) {
    data.result = `Request error: ${xhr?.status}`;
    data.status = "fail";
    throw `Request error: ${xhr?.status}`;
  }

  data.status = "success";
  return;
};

export const ZhipuAI: TranslateService = {
  id: "zhipuai",
  type: "sentence",
  helpUrl: "https://open.bigmodel.cn/dev/api",

  defaultSecret: "",
  secretValidator(secret: string) {
    const status = /^[a-zA-Z0-9._-]{20,}$/.test(secret);
    const empty = secret.length === 0;
    return {
      secret,
      status: status || Boolean(secret),
      info: empty
        ? "The secret is not set."
        : status
          ? "Click the button to check connectivity."
          : "The ZhipuAI API key format might be invalid. Visit https://open.bigmodel.cn/ to get your API key.",
    };
  },

  translate,

  config(settings) {
    settings
      .addTextSetting({
        prefKey: "zhipuai.endPoint",
        nameKey: "service-zhipuai-dialog-endPoint",
      })
      .addTextSetting({
        prefKey: "zhipuai.model",
        nameKey: "service-zhipuai-dialog-model",
      })
      .addNumberSetting({
        prefKey: "zhipuai.temperature",
        nameKey: "service-zhipuai-dialog-temperature",
        min: 0,
        max: 1,
        step: 0.1,
      })
      .addNumberSetting({
        prefKey: "zhipuai.maxTokens",
        nameKey: "service-zhipuai-dialog-maxTokens",
        inputType: "number",
        min: 100,
        max: 10000,
        step: 100,
      })
      .addTextAreaSetting({
        prefKey: "zhipuai.prompt",
        nameKey: "service-zhipuai-dialog-prompt",
      })
      .addCheckboxSetting({
        prefKey: "zhipuai.stream",
        nameKey: "service-zhipuai-dialog-stream",
      });
  },
};
