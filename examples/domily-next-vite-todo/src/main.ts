import { createDomilyApp } from "@domily/next";
import todoDocument from "./todo.dmy.ts";
import { todoCapabilities } from "./todo-service.ts";
import "./style.css";

void createDomilyApp({ capabilities: todoCapabilities }).mount(
  todoDocument,
  "#domily-root",
);
