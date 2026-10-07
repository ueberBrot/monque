---
"@monque/management": minor
"@monque/dashboard": minor
---

Change the priority of up to 100 explicitly selected pending Jobs in the Dashboard or through the selected-action API. Set one signed safe integer for the selection and review the selected count and value before confirming in the Dashboard. Duplicate IDs count once; filters and other pages never add Jobs to the selection.

Each Job requires permission to change priority and must still be pending when the change is applied. Valid changes can succeed while missing, denied, or already claimed Jobs return individual errors. The Dashboard refreshes successful changes and keeps failed IDs selected while their rows remain in view. Read-only mode and unavailable priority actions disable the control.
