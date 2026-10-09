import { useId } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { useFieldContext } from "./context.js";
import { getFieldErrors } from "./field-errors.js";

interface TextFieldProps {
  label: string;
  description?: string;
  placeholder?: string;
  id?: string;
  type?: "email" | "number" | "password" | "search" | "text" | "url";
  invalid?: boolean;
}
export const TextField = ({
  description,
  label,
  placeholder,
  type = "text",
  id,
  invalid,
}: TextFieldProps) => {
  const field = useFieldContext<string>();
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const error = getFieldErrors(field.state.meta.errors);
  const descriptionId =
    description === undefined || description === null || description === ""
      ? undefined
      : `${fieldId}-description`;
  const errorId =
    error === undefined || error === null || error === "" ? undefined : `${fieldId}-error`;
  const descriptionIds = [descriptionId, errorId].filter(Boolean).join(" ");
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <Input
        id={fieldId}
        aria-invalid={invalid === true || Boolean(error)}
        aria-describedby={descriptionIds.length > 0 ? descriptionIds : undefined}
        name={field.name}
        type={type}
        value={field.state.value}
        placeholder={placeholder}
        onBlur={field.handleBlur}
        onChange={(event) => {
          field.handleChange(event.currentTarget.value);
        }}
      />
      {description === undefined || description === null || description === "" ? null : (
        <FieldDescription id={descriptionId}>{description}</FieldDescription>
      )}
      {error === undefined || error === null || error === "" ? null : (
        <FieldError id={errorId}>{error}</FieldError>
      )}
    </Field>
  );
};
