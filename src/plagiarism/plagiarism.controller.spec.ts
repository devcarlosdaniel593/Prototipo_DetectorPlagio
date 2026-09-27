import { Test, TestingModule } from '@nestjs/testing';
import { PlagiarismController } from './plagiarism.controller';

describe('PlagiarismController', () => {
  let controller: PlagiarismController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlagiarismController],
    }).compile();

    controller = module.get<PlagiarismController>(PlagiarismController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
