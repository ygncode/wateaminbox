check agent-loop.sh and improvement-loop.sh

and I want to create consoliated agent-loop.sh

it will use cyolo only for the models.

It will be doing, Autonomous AI-driven code workflow.

the use cases would be like user will ask

agent-loop.sh prompt.md

then agent will read the prompt.md

create .loop/{auto-generated-slug}/requirement.md

then another agent will review the requirement for scability, maintainability, etc....

then will give feedback to the above agent. Then agent will update review. (One loop here).

---

when requirement is ready, next agent will create .loop/{auto-generated-slug}/specs.md (loop again for review, etc...)

when specs is ready, create .loop/{auto-generated-slug}/tasks.md

then loop through the tasks and do the task by agent.

then review agent come in, review the code then add feedbacks tasks to tasks.

then loop through the task and do the task by agent.

## review... (loop)

Learn from https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum as well.
It should include resume feature.
should have max-iterations, so the full flow might be doing a few times.
only create one branch and create PR at the end.

things that user might ask is like

- check the codebase backend and improve the sql query
- incoming/outgoing messages are not working help me check and fix it.
- check the area of the project that can improve and work on it
- etc....

user will add .loop/.system-prompt.md, it will need to load this one at first for the development loop. the rest no need.

for every decision and check, you can use cyolo instead of creating bash.
