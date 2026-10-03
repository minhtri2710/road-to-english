import { app } from "./app";
import { landing } from "./landing";
import { lesson } from "./lesson";
import { library } from "./library";
import { review } from "./review";

// Vietnamese for every English interface string, keyed by the English text.
export const vi: Readonly<Record<string, string>> = { ...app, ...library, ...lesson, ...review, ...landing };
