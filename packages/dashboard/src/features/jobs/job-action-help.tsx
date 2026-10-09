import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const JobActionHelp = ({
  actions,
}: {
  readonly actions: readonly {
    readonly label: string;
    readonly reason: string | null | undefined;
  }[];
}) => {
  const unavailable = actions.filter(
    ({ reason }) => reason !== undefined && reason !== null && reason !== "",
  );
  if (!unavailable.length) {
    return null;
  }
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        Why are actions unavailable?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="grid gap-1 px-2.5 py-2 text-sm text-muted-foreground">
          {unavailable.map(({ label, reason }) => (
            <li key={label}>
              <span className="font-medium text-foreground">{label}: </span>
              {reason}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};
export { JobActionHelp };
