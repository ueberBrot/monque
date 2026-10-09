import { createFormHook } from "@tanstack/react-form";
import { lazy } from "react";

import { CalendarField } from "./calendar-field.js";
import { CheckboxField } from "./checkbox-field.js";
import { fieldContext, formContext } from "./context.js";
import { DateTimeField } from "./date-time-field.js";
import { SelectField } from "./select-field.js";
import { SubmitButton } from "./submit-button.js";
import { TextField } from "./text-field.js";
import { TextareaField } from "./textarea-field.js";

const CommandSearchField = lazy(async () => {
  const module = await import("./command-search-field.js");
  return { default: module.CommandSearchField };
});
export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    CalendarField,
    CheckboxField,
    CommandSearchField,
    DateTimeField,
    SelectField,
    TextareaField,
    TextField,
  },
  fieldContext,
  formComponents: { SubmitButton },
  formContext,
});
