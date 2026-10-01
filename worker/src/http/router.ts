// Routes are a projection of the operation catalog: each Milestone 1
// operation's route comes from `shared/schema`, and a `{name}` segment fills
// the input field of that name (operations.md §7).

import { OPERATIONS, OPERATION_NAMES, routeParams } from '@tc-admin/shared/schema';
import type { OperationDefinition, RoutedOperation } from '@tc-admin/shared/schema';

export interface RouteMatch {
  operation: RoutedOperation;
  params: Record<string, string>;
}

interface CompiledRoute {
  operation: RoutedOperation;
  method: string;
  pattern: RegExp;
  params: string[];
}

const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

const ROUTES: readonly CompiledRoute[] = OPERATION_NAMES.flatMap(name => {
  const route = (OPERATIONS[name] as OperationDefinition).route;
  if (!route) return [];
  const source = route.path.split(/\{[a-z_]+\}/).map(escape).join('([^/]+)');
  return [{ operation: name as RoutedOperation, method: route.method, pattern: new RegExp(`^${source}$`), params: routeParams(route.path) }];
});

export function matchRoute(method: string, pathname: string): RouteMatch | null {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    try {
      return { operation: route.operation, params: Object.fromEntries(route.params.map((name, i) => [name, decodeURIComponent(match[i + 1]!)])) };
    } catch {
      return null;
    }
  }
  return null;
}
