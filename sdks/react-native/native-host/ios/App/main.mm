#import <UIKit/UIKit.h>
#import <React-RCTAppDelegate/RCTDefaultReactNativeFactoryDelegate.h>
#import <React-RCTAppDelegate/RCTReactNativeFactory.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface HostDelegate : RCTDefaultReactNativeFactoryDelegate
@end
@implementation HostDelegate
- (NSURL *)bundleURL { return [[NSBundle mainBundle] URLForResource:@"main.bundle" withExtension:@"js"]; }
- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge { return [self bundleURL]; }
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@property(nonatomic, strong) UIWindow *window;
@property(nonatomic, strong) HostDelegate *reactDelegate;
@property(nonatomic, strong) RCTReactNativeFactory *factory;
@end
@implementation AppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.reactDelegate = [HostDelegate new];
  self.reactDelegate.dependencyProvider = [RCTAppDependencyProvider new];
  self.factory = [[RCTReactNativeFactory alloc] initWithDelegate:self.reactDelegate];
  self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
  [self.factory startReactNativeWithModuleName:@"LikertsNativeAcceptance" inWindow:self.window launchOptions:options];
  return YES;
}
@end

int main(int argc, char *argv[]) {
  @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class])); }
}
