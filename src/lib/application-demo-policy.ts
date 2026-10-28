import { ApplicationError } from './rider-application-policy';
export function assertRealApplication(app: { isDemo?: boolean }) {
  if (app.isDemo) throw new ApplicationError('Demo documents cannot activate real rider services. Complete the demo or start a real application with fresh documents.', 403);
}
