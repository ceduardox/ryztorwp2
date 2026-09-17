import fs from "node:fs";
import { pool } from "../server/db";

const sourcePath = "antigravity teste2 - propuesta ordenada.txt";

function preparePrompt(source: string) {
  const withoutHeader = source.replace(
    /^# PROPUESTA ORDENADA[^\n]*\r?\n\r?\nIMPORTANTE:[^\n]*\r?\n\r?\n/,
    "",
  );
  return withoutHeader.replace(
    /\r?\n## 12\. PUNTOS COMERCIALES QUE DEBEN CONFIRMARSE[\s\S]*$/,
    "",
  ).trim();
}

async function main() {
  const prompt = preparePrompt(fs.readFileSync(sourcePath, "utf8"));
  if (prompt.length > 40_000) throw new Error(`Prompt demasiado extenso: ${prompt.length}`);

  await pool.query(
    `update ai_training_data set content = $1 where title = '__SYSTEM_PROMPT_TERTIARY__'`,
    [prompt],
  );
  await pool.query(
    `update ai_training_data set content = 'tertiary' where title = '__SYSTEM_PROMPT_ACTIVE__'`,
  );
  await pool.query(
    `update ai_settings set system_prompt = $1, conversation_history = 12, updated_at = now()`,
    [prompt],
  );
  console.log(JSON.stringify({ activeSlot: "tertiary", chars: prompt.length, conversationHistory: 12 }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
