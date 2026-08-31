#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

static int writeFiles(int argc, const char *argv[]) {
  NSMutableArray<NSURL *> *urls = [NSMutableArray array];
  NSMutableArray<NSString *> *paths = [NSMutableArray array];
  for (int index = 2; index < argc; index += 1) {
    NSString *filePath = [NSString stringWithUTF8String:argv[index]];
    if (!filePath || ![[NSFileManager defaultManager] fileExistsAtPath:filePath]) continue;
    [paths addObject:filePath];
    [urls addObject:[NSURL fileURLWithPath:filePath]];
  }
  if (urls.count == 0) return 2;
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  if (![pasteboard writeObjects:urls]) return 3;
  [pasteboard addTypes:@[NSFilenamesPboardType] owner:nil];
  [pasteboard setPropertyList:paths forType:NSFilenamesPboardType];
  return 0;
}

static int readFiles(void) {
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  NSArray<NSURL *> *urls = [pasteboard readObjectsForClasses:@[[NSURL class]]
    options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
  for (NSURL *url in urls) {
    const char *filePath = url.path.fileSystemRepresentation;
    if (filePath) fprintf(stdout, "%s\n", filePath);
  }
  return urls.count > 0 ? 0 : 4;
}

static int snapshotPasteboard(NSString *destination) {
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  NSMutableArray *serializedItems = [NSMutableArray array];
  for (NSPasteboardItem *item in pasteboard.pasteboardItems ?: @[]) {
    NSMutableDictionary *serializedItem = [NSMutableDictionary dictionary];
    for (NSPasteboardType type in item.types) {
      NSData *data = [item dataForType:type];
      if (data) serializedItem[type] = data;
    }
    [serializedItems addObject:serializedItem];
  }
  NSError *error = nil;
  NSData *data = [NSPropertyListSerialization dataWithPropertyList:serializedItems
    format:NSPropertyListBinaryFormat_v1_0 options:0 error:&error];
  if (!data || error) return 5;
  return [data writeToFile:destination atomically:YES] ? 0 : 6;
}

static int restorePasteboard(NSString *source) {
  NSData *data = [NSData dataWithContentsOfFile:source];
  if (!data) return 7;
  NSError *error = nil;
  NSArray *serializedItems = [NSPropertyListSerialization propertyListWithData:data
    options:NSPropertyListImmutable format:nil error:&error];
  if (![serializedItems isKindOfClass:[NSArray class]] || error) return 8;
  NSMutableArray<NSPasteboardItem *> *items = [NSMutableArray array];
  for (NSDictionary *serializedItem in serializedItems) {
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    for (NSPasteboardType type in serializedItem) {
      NSData *value = serializedItem[type];
      if ([value isKindOfClass:[NSData class]]) [item setData:value forType:type];
    }
    [items addObject:item];
  }
  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  if (items.count > 0 && ![pasteboard writeObjects:items]) return 9;
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc >= 3 && strcmp(argv[1], "--write") == 0) return writeFiles(argc, argv);
    if (argc == 2 && strcmp(argv[1], "--read") == 0) return readFiles();
    if (argc == 3 && strcmp(argv[1], "--snapshot") == 0) {
      return snapshotPasteboard([NSString stringWithUTF8String:argv[2]]);
    }
    if (argc == 3 && strcmp(argv[1], "--restore") == 0) {
      return restorePasteboard([NSString stringWithUTF8String:argv[2]]);
    }
    return 64;
  }
}
