#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(KeystoreModule, NSObject)

RCT_EXTERN_METHOD(getOrCreateKey:(NSString *)alias
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(encryptString:(NSString *)alias
                  plaintext:(NSString *)plaintext
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(decryptString:(NSString *)alias
                  encryptedData:(NSString *)encryptedData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
