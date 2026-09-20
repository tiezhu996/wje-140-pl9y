import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DispatchService } from '../services/dispatch.service';
import {
  AssignOrderPayload,
  CompleteOrderPayload,
  StartOrderPayload
} from '../types/interfaces';

@Controller('dispatch-orders')
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** 调度单详情：可读取实际到达时间及实际油费/路费/人工/利润四类金额 */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.getDetail(Number(id));
  }

  @Post()
  create(@Body() payload: any) {
    return this.service.create(payload);
  }

  /** 派单：校验车辆/司机空闲与冷链车型匹配，占用车辆与司机 */
  @Post(':id/assign')
  assign(@Param('id') id: string, @Body() payload: AssignOrderPayload) {
    return this.service.assign(Number(id), payload);
  }

  /** 开始运输：登记实际出发时间与出发里程 */
  @Post(':id/start')
  start(@Param('id') id: string, @Body() payload: StartOrderPayload) {
    return this.service.start(Number(id), payload);
  }

  /** 完成结算：按实际里程重算费用，同事务写费用汇总、推进里程并释放资源 */
  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() payload: CompleteOrderPayload) {
    return this.service.complete(Number(id), payload);
  }

  /** 取消：不结算，只释放车辆与司机 */
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(Number(id));
  }
}
