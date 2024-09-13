const TestLibrary = global.__TEST_LIBRARY__;
describe('API Tests', () => {
  it('should test testService', async () => {
    await TestLibrary.testRequest({
      method: 'GET',
      path: '/test',
      expectedService: 'test',
      expectedStatus: 200,
    });
  });

  it('should test testService using headers', async () => {
    await TestLibrary.testRequest({
      method: 'GET',
      path: '/test',
      expectedHeaders: {
        'x-proxy-destination': 'lala.null.com:8443'
      },
      expectedStatus: 200,
    });
  });

  it('should not anwer /lala', async () => {
    await TestLibrary.testRequest({
      method: 'GET',
      path: '/lala',
      expectedStatus: 404,
    });
  });
});

