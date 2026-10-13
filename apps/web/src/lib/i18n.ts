import { ES } from './es';

export type Lang = 'es' | 'en';

/** Spanish unless this browser chose English; switching reloads the page. */
export const lang: Lang = typeof localStorage !== 'undefined' && localStorage.getItem('lang') === 'en' ? 'en' : 'es';
export const locale = lang === 'es' ? 'es-CR' : 'en-US';

export function setLang(l: Lang) {
  localStorage.setItem('lang', l);
  location.reload();
}

/** Translate an English UI string; `{name}` placeholders are filled from `vars`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'es' ? (ES[s] ?? s) : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

const SERVER_PATTERNS: [RegExp, string][] = [
  [/^Already exists \((.*)\)$/, 'Ya existe ($1)'],
  [/^Rate limit exceeded, retry in (.*)$/, 'Demasiados intentos; inténtelo de nuevo en $1'],
  [/^Duplicate test file name "(.*)" \((.*) and (.*)\)$/, 'Nombre de prueba duplicado "$1" ($2 y $3)'],
  [/^No uploaded file matches a test\. Name output files like (.*)$/, 'Ningún archivo subido corresponde a una prueba. Nombre los archivos de salida como $1'],
  [/^Not a valid zip file: (.*)$/, 'No es un archivo zip válido: $1'],
  [/^Problem (.*) has no test data yet$/, 'El problema $1 aún no tiene datos de prueba'],
  [/^Submission limit reached \((\d+) per task\)$/, 'Límite de envíos alcanzado ($1 por problema)'],
  [/^Subtask (\d+): "(.*)" is not a valid score with (\d+) decimal\(s\)$/, 'Subtarea $1: "$2" no es un puntaje válido con $3 decimal(es)'],
  [/^Subtask (\d+): unknown test "(.*)"$/, 'Subtarea $1: prueba desconocida "$2"'],
  [/^Test "(.*)" has no \.out\/\.ans file$/, 'La prueba "$1" no tiene archivo .out/.ans'],
  [/^Zip has more than (\d+) files$/, 'El zip tiene más de $1 archivos'],
  [/^Row (\d+): username "(.*)" already exists$/, 'Fila $1: el usuario "$2" ya existe'],
  [/^Row (\d+): (.*)$/, 'Fila $1: $2'],
];

/** Server error messages are English; show them in the UI language. */
export function tServer(msg: string): string {
  if (lang !== 'es') return msg;
  if (ES[msg]) return ES[msg]!;
  for (const [re, rep] of SERVER_PATTERNS) if (re.test(msg)) return msg.replace(re, rep);
  const zod = /^([\w.]+): (.*)$/.exec(msg);
  if (zod) return `${zod[1]}: ${ES[zod[2]!] ?? zod[2]}`;
  return msg;
}
