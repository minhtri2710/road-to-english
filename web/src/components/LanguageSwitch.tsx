import { Button } from "@astryxdesign/core/Button";

import { setLang, useLang } from "../i18n";

// Switches the interface between English and Vietnamese. The button names the other language in
// that language, so a learner can find it whichever language is showing.
export function LanguageSwitch() {
  const lang = useLang();
  const other = lang === "en" ? "vi" : "en";
  return (
    <Button
      label={other === "vi" ? "Tiếng Việt" : "English"}
      children={<span lang={other}>{other === "vi" ? "Tiếng Việt" : "English"}</span>}
      variant="ghost"
      data-testid="language-switch"
      onClick={() => setLang(other)}
    />
  );
}
