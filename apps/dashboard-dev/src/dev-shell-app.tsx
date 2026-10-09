import type { ReactElement } from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAppForm } from "@/forms/form";
import { createDashboardManagementApi } from "@/management-client";
import { DashboardProviders } from "@/providers";
import { createDashboardQueryClient } from "@/query-client";
import { getRouter } from "@/router";

import type { DashboardDevEnvironment } from "./environment.js";
import { isDashboardDevScenarioId } from "./mock/scenario-catalog.js";
import type { DashboardDevScenarioId } from "./mock/scenario-catalog.js";
import { createDashboardRuntimeConfig, dashboardDevScenarioOptions } from "./runtime-config.js";
import { createScenarioHeaderFetch } from "./scenario-header-fetch.js";

const LOCAL_STORAGE_SCENARIO_KEY = "monque-dashboard-dev-scenario";
const getStoredScenarioId = (defaultScenarioId: DashboardDevScenarioId): DashboardDevScenarioId => {
  if (globalThis.window === undefined) {
    return defaultScenarioId;
  }
  let storedScenarioId: string | null;
  try {
    storedScenarioId = window.localStorage.getItem(LOCAL_STORAGE_SCENARIO_KEY);
  } catch {
    return defaultScenarioId;
  }
  return isDashboardDevScenarioId(storedScenarioId) ? storedScenarioId : defaultScenarioId;
};
const DashboardDevOverlay = ({
  environment,
  scenarioId,
  onScenarioChange,
}: {
  readonly environment: DashboardDevEnvironment;
  readonly scenarioId: DashboardDevScenarioId;
  readonly onScenarioChange: (scenarioId: DashboardDevScenarioId) => void;
}): ReactElement => {
  const form = useAppForm({ defaultValues: { scenario: scenarioId } });
  useEffect(() => {
    form.reset({ scenario: scenarioId });
  }, [form, scenarioId]);
  return (
    <Collapsible
      data-testid="dashboard-dev-shell"
      className="max-h-[40dvh] shrink-0 overflow-y-auto border-b border-border bg-muted/50 px-4 py-2 text-xs"
    >
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}
      >
        Development ·{" "}
        {(() => {
          if (environment.mode === "db") {
            return "Local MongoDB";
          }
          if (environment.mode === "live") {
            return "Live Management API";
          }
          return "Mock Management API";
        })()}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-wrap items-center gap-3 py-3">
          {environment.mode === "mock" ? (
            <>
              <label htmlFor="dev-scenario" className="flex items-center gap-2">
                Scenario
                <form.AppField
                  name="scenario"
                  listeners={{
                    onChange: ({ value }) => {
                      if (isDashboardDevScenarioId(value)) {
                        onScenarioChange(value);
                      }
                    },
                  }}
                >
                  {(field) => (
                    <field.SelectField
                      bare
                      id="dev-scenario"
                      label="Scenario"
                      className="w-48"
                      options={dashboardDevScenarioOptions.map((scenario) => ({
                        value: scenario.id,
                        label: scenario.label,
                      }))}
                    />
                  )}
                </form.AppField>
              </label>
              <span className="text-muted-foreground">
                Changes last until the development server restarts.
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {environment.mode === "db"
                ? "Local MongoDB with running workers. Demo jobs arrive every 15 seconds; views refresh every second."
                : "Requests use the configured Management API proxy."}
            </span>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
type DevManagementApiOptions = {
  -readonly [Key in keyof Parameters<typeof createDashboardManagementApi>[0]]: Parameters<
    typeof createDashboardManagementApi
  >[0][Key];
};
const createDevRuntime = (
  mode: DashboardDevEnvironment["mode"],
  scenarioId: DashboardDevScenarioId,
) => {
  const runtimeConfig = createDashboardRuntimeConfig({ mode, scenarioId });
  const apiOptions: DevManagementApiOptions = {
    apiBaseUrl: runtimeConfig.apiBaseUrl,
    origin: window.location.origin,
  };
  if (mode === "mock") {
    apiOptions.fetch = createScenarioHeaderFetch(scenarioId);
  }
  const managementApi = createDashboardManagementApi(apiOptions);
  const queryClient = createDashboardQueryClient();
  const router = getRouter({ managementApi, queryClient, runtimeConfig });
  return { router, queryClient };
};
const DashboardDevRuntime = ({
  environment,
  scenarioId,
}: {
  readonly environment: DashboardDevEnvironment;
  readonly scenarioId: DashboardDevScenarioId;
}): ReactElement => {
  const runtime = useMemo(
    () => createDevRuntime(environment.mode, scenarioId),
    [environment.mode, scenarioId],
  );
  const { router, queryClient } = runtime;
  return <DashboardProviders queryClient={queryClient} router={router} />;
};
const DashboardDevShellApp = ({
  environment,
}: {
  readonly environment: DashboardDevEnvironment;
}): ReactElement => {
  const [scenarioId, setScenarioId] = useState<DashboardDevScenarioId>(() =>
    getStoredScenarioId(environment.scenarioId),
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_SCENARIO_KEY, scenarioId);
    } catch {
      // Browser privacy settings can prevent storing the selected scenario.
    }
  }, [scenarioId]);
  return (
    <>
      <DashboardDevOverlay
        environment={environment}
        scenarioId={scenarioId}
        onScenarioChange={setScenarioId}
      />
      <DashboardDevRuntime
        key={`${environment.mode}:${scenarioId}`}
        environment={environment}
        scenarioId={scenarioId}
      />
    </>
  );
};
export { DashboardDevShellApp };
