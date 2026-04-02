import { injectable } from "inversify";

@injectable()
export class ProjectModeLockStore {
  private readonly switchingProjects = new Set<string>();

  public acquireLock(projectId: string): boolean {
    if (this.switchingProjects.has(projectId)) return false;
    this.switchingProjects.add(projectId);
    return true;
  }

  public releaseLock(projectId: string): void {
    this.switchingProjects.delete(projectId);
  }
}
