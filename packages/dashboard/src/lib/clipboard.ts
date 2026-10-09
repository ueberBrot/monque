import { toast } from "sonner";

const copyToClipboard = async (
  value: string,
  successMessage = "Copied to clipboard",
): Promise<void> => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
  } catch {
    toast.error("Copy failed", {
      description: "Copy the value or URL manually.",
      duration: Number.POSITIVE_INFINITY,
    });
  }
};
export { copyToClipboard };
