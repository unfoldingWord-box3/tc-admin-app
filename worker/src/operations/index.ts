// The implemented operations, by catalog name. The HTTP projection routes to
// these; a catalog operation not listed here is not built yet.

import type { OperationOutput, ParsedInput, RoutedOperation } from '@tc-admin/shared/schema';
import type { OperationContext } from './context';
import { languageList } from './language-list';
import { portfolioList } from './portfolio-list';
import { projectCreateApply } from './project-create-apply';
import { projectCreatePlan } from './project-create-plan';
import { situationRead } from './situation-read';

export type OperationHandler<Name extends RoutedOperation> = (input: ParsedInput<Name>, context: OperationContext) => Promise<OperationOutput<Name>>;

export type OperationHandlers = { [Name in RoutedOperation]?: OperationHandler<Name> };

export const HANDLERS: OperationHandlers = {
  'situation.read': situationRead,
  'portfolio.list': portfolioList,
  'project.create.plan': projectCreatePlan,
  'project.create.apply': projectCreateApply,
  'language.list': languageList,
};

export { operationContext, signedIn } from './context';
export type { DeploymentConfig, OperationContext } from './context';
