// The implemented operations, by catalog name. The HTTP projection routes to
// these; a catalog operation not listed here is not built yet.

import type { OperationOutput, ParsedInput, RoutedOperation } from '@tc-admin/shared/schema';
import type { OperationContext } from './context';
import { languageList } from './language-list';
import { ownerList } from './owner-list';
import { portfolioList } from './portfolio-list';
import { preparationDiscard } from './preparation-discard';
import { preparationRead } from './preparation-read';
import { projectCreateApply } from './project-create-apply';
import { projectCreatePlan } from './project-create-plan';
import { releaseLookup } from './release-lookup';
import { releaseCreate } from './release-create';
import { releasePlan } from './release-plan';
import { releasePrepare } from './release-prepare';
import { releasePromote } from './release-promote';
import { situationRead } from './situation-read';

export type OperationHandler<Name extends RoutedOperation> = (input: ParsedInput<Name>, context: OperationContext) => Promise<OperationOutput<Name>>;

export type OperationHandlers = { [Name in RoutedOperation]?: OperationHandler<Name> };

export const HANDLERS: OperationHandlers = {
  'situation.read': situationRead,
  'portfolio.list': portfolioList,
  'project.create.plan': projectCreatePlan,
  'project.create.apply': projectCreateApply,
  'language.list': languageList,
  'owner.list': ownerList,
  'release.lookup': releaseLookup,
  'release.plan': releasePlan,
  'release.prepare': releasePrepare,
  'preparation.read': preparationRead,
  'preparation.discard': preparationDiscard,
  'release.create': releaseCreate,
  'release.promote': releasePromote,
};

export { operationContext, signedIn } from './context';
export type { DeploymentConfig, OperationContext } from './context';
