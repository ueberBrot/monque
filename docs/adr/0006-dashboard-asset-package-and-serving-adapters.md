# ADR-0006: Dashboard Asset Package And Serving Adapters

Ship the Dashboard as an asset/UI package with separate serving adapters so one
build works across host frameworks and mount paths. Hosts compose Dashboard
serving, Management and authentication independently. Keep server runtime and
persistence dependencies outside the browser; the Dashboard depends on the shared
Management contract.
