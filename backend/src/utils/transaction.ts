/**
 * 内存态事务协调器。
 *
 * 项目当前以内存行模拟数据库表，这里用「登记快照 -> 执行业务 -> 异常逆序恢复」
 * 模拟 TypeORM DataSource.transaction 的原子性：调度单完成结算时，调度单、
 * 车辆、司机、费用汇总四个参与方必须在同一事务内提交，任一步骤抛出冲突，
 * 四项状态全部恢复到事务开始前的快照。
 */
export interface TransactionalParticipant {
  /** 登记时导出自身状态快照 */
  snapshot(): unknown;
  /** 回滚时用快照恢复状态 */
  restore(checkpoint: unknown): void;
}

export class InMemoryTransaction {
  private readonly members: TransactionalParticipant[] = [];
  private readonly checkpoints: unknown[] = [];
  private finished = false;

  /** 登记参与方，登记瞬间保存快照，重复登记同一参与方只保留首份快照 */
  enlist(member: TransactionalParticipant): void {
    if (this.finished) {
      throw new Error('事务已结束，不能再登记参与方');
    }
    if (this.members.includes(member)) {
      return;
    }
    this.members.push(member);
    this.checkpoints.push(member.snapshot());
  }

  /** 执行业务操作；抛异常时按登记逆序回滚全部参与方后再把异常抛给调用方 */
  async execute<T>(operation: () => Promise<T> | T): Promise<T> {
    try {
      const result = await operation();
      this.finished = true;
      return result;
    } catch (error) {
      for (let i = this.members.length - 1; i >= 0; i -= 1) {
        this.members[i].restore(this.checkpoints[i]);
      }
      this.finished = true;
      throw error;
    }
  }
}
