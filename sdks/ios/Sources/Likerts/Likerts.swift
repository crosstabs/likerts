import Foundation

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
public enum SDKTarget: String, Codable, Sendable {
  case web
  case reactNative = "react_native"
  case ios, android, flutter
}
public struct SDKInstallationCapability: Codable, Sendable, Equatable {
  public let target: SDKTarget
  public let sdkVersion: String
  public let schemaVersions: [Int]
  public init(target: SDKTarget, sdkVersion: String, schemaVersions: [Int]) {
    self.target = target
    self.sdkVersion = sdkVersion
    self.schemaVersions = schemaVersions
  }
}
public let likertsSDKCapability = SDKInstallationCapability(
  target: .ios, sdkVersion: "0.0.3", schemaVersions: [1, 2, 3, 4, 5])
public enum VisibilityOperator: String, Codable, Sendable, Equatable {
  case equals, includes, answered
  case notEquals = "not_equals"
  case notIncludes = "not_includes"
  case notAnswered = "not_answered"
}
public enum VisibilityValue: Codable, Sendable, Equatable {
  case string(String), number(Double)
  public init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if let string = try? value.decode(String.self) { self = .string(string) }
    else { self = .number(try value.decode(Double.self)) }
  }
  public func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self { case .string(let string): try value.encode(string); case .number(let number): try value.encode(number) }
  }
}
public struct VisibilityCondition: Codable, Sendable, Equatable {
  public let questionId: String
  public let `operator`: VisibilityOperator
  public let value: VisibilityValue?
  public init(questionId: String, operator: VisibilityOperator, value: VisibilityValue? = nil) {
    self.questionId=questionId;self.operator=`operator`;self.value=value
  }
}
public struct PageBranch: Codable, Sendable, Equatable {
  public let when: VisibilityCondition
  public let goToPageId: String
  public init(when: VisibilityCondition, goToPageId: String) { self.when=when;self.goToPageId=goToPageId }
}
public struct SurveyPage: Codable, Sendable, Equatable {
  public let id: String
  public let title: String?
  public let questionIds: [String]
  public let branches: [PageBranch]?
  public init(id:String,title:String?=nil,questionIds:[String],branches:[PageBranch]?=nil){self.id=id;self.title=title;self.questionIds=questionIds;self.branches=branches}
}
public struct PromptItem: Codable, Sendable, Equatable { public let id:String;public let label:String;public init(id:String,label:String){self.id=id;self.label=label} }
public struct Question: Codable, Sendable {
  public let id: String
  public let type: String
  public let label: String
  public let required: Bool?
  public let options: [Option]?
  public let min: Double?
  public let max: Double?
  public let maxLength: Int?
  public let preset: String?
  public let labels: [String: String]?
  public let minSelections: Int?
  public let maxSelections: Int?
  public let visibleWhen: VisibilityCondition?
  public let presentation: String?
  public let rows:[PromptItem]?
  public let columns:[Option]?
  public let matrixMode:String?
  public let items:[PromptItem]?
  public let total:Int?
  public init(
    id: String, type: String, label: String, required: Bool? = nil, options: [Option]? = nil,
    min: Double? = nil, max: Double? = nil, maxLength: Int? = nil, preset: String? = nil,
    labels: [String: String]? = nil, minSelections: Int? = nil, maxSelections: Int? = nil,
    visibleWhen: VisibilityCondition? = nil, presentation: String? = nil,
    rows:[PromptItem]?=nil,columns:[Option]?=nil,matrixMode:String?=nil,items:[PromptItem]?=nil,total:Int?=nil
  ) {
    self.id = id
    self.type = type
    self.label = label
    self.required = required
    self.options = options
    self.min = min
    self.max = max
    self.maxLength = maxLength
    self.preset = preset
    self.labels = labels
    self.minSelections = minSelections
    self.maxSelections = maxSelections
    self.visibleWhen = visibleWhen
    self.presentation = presentation
    self.rows=rows;self.columns=columns;self.matrixMode=matrixMode;self.items=items;self.total=total
  }
  public var scaleValues: [Int] {
    guard type == "scale", preset == "nps" || labels != nil, let min, let max, min >= -10000,
      max <= 10000, min <= max
    else { return [] }
    return Array(Int(min)...Int(max))
  }
  public func scaleLabel(_ value: Int) -> String {
    labels?[String(value)].map { "\(value) — \($0)" } ?? String(value)
  }
  /// Local selection feedback; the server remains authoritative.
  public func selectionError(_ selected: [String]?) -> String? {
    guard type == "multiple_choice" else { return nil }
    guard let selected else { return required == true ? "Choose at least one option" : nil }
    let minimum = Swift.max(minSelections ?? 0, required == true ? 1 : 0)
    if selected.count < minimum { return "Choose at least \(minimum) options" }
    if let maximum = maxSelections, selected.count > maximum {
      return "Choose at most \(maximum) options"
    }
    return nil
  }
  public func validationError(textValue: String?, selected: [String]?) -> String? {
    let missing =
      type == "multiple_choice" ? (selected?.isEmpty != false) : (textValue?.isEmpty != false)
    if required == true && missing { return "\(label): an answer is required." }
    return selectionError(selected)
  }
  public struct Option: Codable, Sendable {
    public let id: String
    public let label: String
    public let other: OtherText?
    public let exclusive: Bool?
    public init(id: String, label: String, other: OtherText? = nil, exclusive: Bool? = nil) {
      self.id = id
      self.label = label
      self.other = other
      self.exclusive = exclusive
    }
  }
  public struct OtherText: Codable, Sendable { public let maxLength:Int;public init(maxLength:Int){self.maxLength=maxLength} }
}
public struct SurveySchema: Codable, Sendable {
  public let schemaVersion: Int
  public let title: String
  public let questions: [Question]
  public let pages: [SurveyPage]?
  public init(schemaVersion: Int, title: String, questions: [Question], pages: [SurveyPage]? = nil) {
    self.schemaVersion = schemaVersion
    self.title = title
    self.questions = questions
    self.pages = pages
  }
}
public struct Collection: Codable, Sendable {
  public let id: String
  public let surveyId: String
  public let version: Int
  public let placement: String
  public let schema: SurveySchema
  private enum CodingKeys: String, CodingKey { case id, surveyId, version, placement, schema }
  public init(id: String, surveyId: String, version: Int, placement: String, schema: SurveySchema)
    throws
  {
    guard [1, 2, 3, 4, 5].contains(schema.schemaVersion) else { throw LikertsError.unsupportedSchema }
    self.id = id
    self.surveyId = surveyId
    self.version = version
    self.placement = placement
    self.schema = schema
  }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    surveyId = try values.decode(String.self, forKey: .surveyId)
    version = try values.decode(Int.self, forKey: .version)
    placement = try values.decode(String.self, forKey: .placement)
    schema = try values.decode(SurveySchema.self, forKey: .schema)
    guard [1, 2, 3, 4, 5].contains(schema.schemaVersion) else { throw LikertsError.unsupportedSchema }
  }
}
/// JSON metadata remains untrusted customer context, including nested values.
public enum JSONValue: Codable, Sendable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])
  public init(from decoder: Decoder) throws {
    let value = try decoder.singleValueContainer()
    if value.decodeNil() {
      self = .null
    } else if let v = try? value.decode(Bool.self) {
      self = .bool(v)
    } else if let v = try? value.decode(Double.self) {
      self = .number(v)
    } else if let v = try? value.decode(String.self) {
      self = .string(v)
    } else if let v = try? value.decode([JSONValue].self) {
      self = .array(v)
    } else {
      self = .object(try value.decode([String: JSONValue].self))
    }
  }
  public func encode(to encoder: Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .null: try value.encodeNil()
    case .bool(let v): try value.encode(v)
    case .number(let v): try value.encode(v)
    case .string(let v): try value.encode(v)
    case .array(let v): try value.encode(v)
    case .object(let v): try value.encode(v)
    }
  }
}
extension JSONValue: ExpressibleByStringLiteral {
  public init(stringLiteral value: String) { self = .string(value) }
}
extension JSONValue: ExpressibleByIntegerLiteral {
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
}
extension JSONValue: ExpressibleByFloatLiteral {
  public init(floatLiteral value: Double) { self = .number(value) }
}
extension JSONValue: ExpressibleByBooleanLiteral {
  public init(booleanLiteral value: Bool) { self = .bool(value) }
}
extension JSONValue: ExpressibleByNilLiteral { public init(nilLiteral: ()) { self = .null } }
extension JSONValue: ExpressibleByArrayLiteral {
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
}
extension JSONValue: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self = .object(Dictionary(elements, uniquingKeysWith: { _, latest in latest }))
  }
}
public struct Receipt: Codable, Sendable, Equatable {
  public let responseId: String
  public let collectionId: String
  public let accepted: Bool
  private enum CodingKeys: String, CodingKey {
    case responseId, collectionId, accepted
  }
  public init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    responseId = try values.decode(String.self, forKey: .responseId)
    collectionId = try values.decode(String.self, forKey: .collectionId)
    accepted = try values.decode(Bool.self, forKey: .accepted)
    guard accepted else { throw LikertsError.invalidReceipt }
  }
}
public enum Answer: Encodable, Sendable {
  case text(String)
  case number(Double)
  case choices([String])
  case other(selected: [String], otherText: [String: String])
  case ranking([String])
  case matrixSingle([String:String])
  case matrixMultiple([String:[String]])
  case allocation([String:Int])
  private struct OtherAnswer: Encodable { let selected:[String];let otherText:[String:String] }
  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .text(let v): try c.encode(v)
    case .number(let v): try c.encode(v)
    case .choices(let v): try c.encode(v)
    case .other(let selected, let otherText): try c.encode(OtherAnswer(selected:selected,otherText:otherText))
    case .ranking(let v):try c.encode(v)
    case .matrixSingle(let v):try c.encode(v)
    case .matrixMultiple(let v):try c.encode(v)
    case .allocation(let v):try c.encode(v)
    }
  }
}
public struct Submission: Encodable, Sendable {
  public let idempotencyKey: String
  public let answers: [String: Answer]
  public let metadata: [String: JSONValue]
  public init(
    idempotencyKey: String = UUID().uuidString, answers: [String: Answer],
    metadata: [String: JSONValue] = [:]
  ) {
    self.idempotencyKey = idempotencyKey
    self.answers = answers
    self.metadata = metadata
  }
}
public enum LikertsError: Error {
  case invalidURL
  case http(Int, String)
  case unsupportedSchema, invalidReceipt, invalidTimeout, bindingChanged
}
final class LikertsRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  static let shared = LikertsRedirectDelegate()
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
/// Public collection tokens only. Preserve a Submission value when retrying.
public struct LikertsClient: Sendable {
  private let baseURL: URL
  private let token: String
  private let session: URLSession
  private let timeout: TimeInterval
  private let cacheMaxAge: TimeInterval
  private let cache = CollectionCache()
  public init(
    baseURL: URL, collectionToken: String, timeout: TimeInterval = 15,
    cacheMaxAge: TimeInterval = 300, session: URLSession = .shared
  ) {
    self.baseURL = baseURL
    token = collectionToken
    self.timeout = timeout
    self.cacheMaxAge = cacheMaxAge
    self.session = session
  }
  private func validateConfiguration() throws {
    let loopback = ["localhost", "127.0.0.1", "::1"].contains(baseURL.host?.lowercased() ?? "")
    guard baseURL.scheme == "https" || (baseURL.scheme == "http" && loopback), baseURL.user == nil,
      baseURL.password == nil, baseURL.query == nil, baseURL.fragment == nil
    else { throw LikertsError.invalidURL }
    guard timeout > 0 && timeout.isFinite else { throw LikertsError.invalidTimeout }
    guard cacheMaxAge >= 0 && cacheMaxAge.isFinite else { throw LikertsError.invalidTimeout }
  }
  private func request(collectionId: String, submission: Submission? = nil) async throws -> Data {
    try validateConfiguration()
    var url = baseURL.appendingPathComponent("v1").appendingPathComponent("collections")
      .appendingPathComponent(collectionId)
    if submission != nil { url = url.appendingPathComponent("responses") }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let submission {
      req.httpMethod = "POST"
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try JSONEncoder().encode(submission)
    }
    let (data, response) = try await session.data(
      for: req, delegate: LikertsRedirectDelegate.shared)
    guard let http = response as? HTTPURLResponse else { throw LikertsError.invalidURL }
    guard (200..<300).contains(http.statusCode) else {
      throw LikertsError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "")
    }
    return data
  }
  public func collection(_ id: String, refresh: Bool = false) async throws -> Collection {
    if !refresh, let cached = await cache.get(id, maxAge: cacheMaxAge) { return cached }
    do {
      let c = try JSONDecoder().decode(Collection.self, from: await request(collectionId: id))
      guard [1, 2, 3, 4, 5].contains(c.schema.schemaVersion) else { throw LikertsError.unsupportedSchema }
      try await cache.store(id, c)
      return c
    } catch {
      await cache.remove(id)
      throw error
    }
  }
  public func clearCollectionCache(_ id: String? = nil) async { await cache.remove(id) }
  /// Only an accepted server receipt confirms completion. A transport error is not proof of rejection.
  public func submit(collectionId: String, submission: Submission) async throws -> Receipt {
    try JSONDecoder().decode(
      Receipt.self, from: await request(collectionId: collectionId, submission: submission))
  }
}
private actor CollectionCache {
  private var entries: [String: (Collection, Date)] = [:]
  func get(_ id: String, maxAge: TimeInterval) -> Collection? {
    guard let (value, date) = entries[id], Date().timeIntervalSince(date) < maxAge else {
      return nil
    }
    return value
  }
  func store(_ id: String, _ value: Collection) throws {
    if let (old, _) = entries[id],
      old.id != value.id || old.surveyId != value.surveyId || old.version != value.version
        || old.schema.schemaVersion != value.schema.schemaVersion
    {
      entries.removeValue(forKey: id)
      throw LikertsError.bindingChanged
    }
    entries[id] = (value, Date())
  }
  func remove(_ id: String?) {
    if let id { entries.removeValue(forKey: id) } else { entries.removeAll() }
  }
}
