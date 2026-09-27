import { Test, TestingModule } from '@nestjs/testing';
import { PlagiarismService } from './plagiarism.service';

describe('PlagiarismService', () => {
  let service: PlagiarismService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PlagiarismService],
    }).compile();

    service = module.get<PlagiarismService>(PlagiarismService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
