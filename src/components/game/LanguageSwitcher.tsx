import { LocalePicker } from "@/components/LocalePicker";

/**
 * This was `return null` — a switcher that rendered nothing, next to ru/uk/zh
 * catalogs that were never loaded. The language could not be changed and the
 * translations could not be reached, and neither failure was visible in the
 * repo, because the files existed and looked complete.
 *
 * It now renders the one picker the whole app shares, so changing the language
 * here changes it everywhere rather than in a corner of its own.
 */
export default function LanguageSwitcher() {
  return <LocalePicker />;
}
