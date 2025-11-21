# .NET Application - ASP.Net, .Net Core, C#, Oracle PL&#x2F;SQL, Git with GitLab, VueJS, Angular, React, and Bootstrap CSS v4

## Project Overview
This is a web-application built with ASP.Net, .Net Core, C#, Oracle PL&#x2F;SQL, Git with GitLab, VueJS, Angular, React, and Bootstrap CSS v4.

## Technology Stack
- **Primary Technologies**: ASP.Net, .Net Core, C#, Oracle PL&#x2F;SQL, Git with GitLab, VueJS, Angular, React, and Bootstrap CSS v4
- **Project Type**: web-application


## Development Commands & Environment

# Build Commands

## Core Development Commands
```bash
# Build all projects or specific project
dotnet build                    # Build all projects in solution
dotnet build [ProjectName]      # Build specific project

# Run applications
dotnet run --project [ProjectPath]   # Run specific project
dotnet run                           # Run from project directory

# Test projects
dotnet test                     # Run all tests in solution
dotnet test [TestProject]       # Run specific test project

# Restore dependencies
dotnet restore                  # Restore all projects in solution

# Publish for deployment
dotnet publish [ProjectPath] -c Release

# Watch for changes during development
dotnet watch run --project [ProjectPath]
```

## Monorepo Architecture
.NET monorepo with multiple applications and shared libraries:
- Multiple project types (.NET Framework 4.8, .NET Core 8+)
- Shared libraries and common components
- SCApplicationSupport for data access
- Various application types (web, services, tools)
- Cross-project dependencies

## Development Standards
- Use solution-level operations when possible
- Build specific projects for targeted development
- Follow Microsoft coding conventions across all projects
- Use `dotnet` CLI for .NET Core/6+ projects
- Use appropriate tools for .NET Framework projects
- Maintain consistent patterns across the monorepo



## Project Structure
```
src/                    # Source code
  Controllers/          # Web API controllers
  Models/               # Data models and entities
  Services/             # Business logic services
  Repositories/         # Data access layer
  DTOs/                 # Data transfer objects
  Middleware/           # Request/response middleware
  Configuration/        # Application configuration
wwwroot/               # Static web assets
  css/                 # Stylesheets
  js/                  # JavaScript files
  images/              # Image assets
bin/                   # Compiled binaries
obj/                   # Build artifacts
Tests/                 # Test projects
  UnitTests/           # Unit test projects
  IntegrationTests/    # Integration test projects
Properties/            # Project properties
appsettings.json       # Application configuration
Program.cs             # Application entry point
*.csproj              # Project file
```



## Development Guidelines

### Code Standards
# .NET Code Guide

This document defines coding standards and practices for .NET development to ensure clarity, consistency, maintainability, and security across all projects. It applies to developers working with .NET Framework 4.8, .NET Core 8, C#, Oracle, AppServer ORM, ASP.NET Core, and related technologies.

## 1. General Coding Principles

- **Multi-targeting Support**: Be aware of shared libraries that may target both .NET Framework 4.8 and .NET Core 8. Use conditional compilation directives when necessary (`#if NETFRAMEWORK` vs `#if NETCOREAPP`).
- **Readability**: Write clear, concise, and well-documented code.
- **Consistency**: Follow established patterns and conventions throughout the codebase.
- **Maintainability**: Design code that is easy to understand, modify, and debug.
- **Performance**: Be mindful of performance implications and optimize critical sections of code.
- **Security**: Follow security best practices to protect against common vulnerabilities.
- **API Availability**: Check API availability for the target framework before using specific .NET features. Some APIs are not available in .NET Framework 4.8.
- Utilize appropriate .NET features based on the target framework (.NET Framework vs .NET Core middleware, dependency injection patterns, etc.).
- Write small, focused methods and functions (ideally <50-75 lines).
- Favor readability and simplicity over overly complex solutions.
- Apply [DRY (Don't Repeat Yourself) principles](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself)
- Apply [SOLID principles](https://en.wikipedia.org/wiki/SOLID)
- Adhere to established C# coding conventions (e.g., [Microsoft C# Coding Conventions](https://docs.microsoft.com/en-us/dotnet/csharp/fundamentals/coding-style/coding-conventions))
- Comment on intent and reasoning, not what the code obviously does. Use XML documentation comments for public APIs.
- Avoid magic values; use constants (`const`), readonly static fields, or configuration values.
- Implement robust error handling (e.g., try-catch blocks, custom exceptions) and logging (e.g., Serilog, NLog, or built-in ILogger).
- Write testable code and create unit tests (e.g., using NUnit, xUnit, MSTest). Run automated tests before committing changes.
- To avoid unnecessary merge conflicts and cognitive load on code reviews, do not refactor, alter whitespace, or change formatting to blocks of code you are not also applying functional changes to.

## 2. .NET Framework Detection & Migration Strategy

This codebase contains both .NET Framework 4.8 and .NET Core 8 projects, with many shared files that support projects targeting either framework. When making changes to any file, it's critical to ensure compatibility with all referencing projects. Leverage memory tools to track framework constraints for each file in the following format:
```
FRAMEWORK_ANALYSIS: [filename]
File Location: [project/folder context]
Referencing Projects: [list of .csproj files that include this file]
Target Frameworks: [frameworks from referencing projects]
Constraint: [most restrictive framework - determines coding patterns]
```

## 3. C# Best Practices

### 3.1 Structure & Organization

- Follow established architectural patterns (e.g., MVC, MVVM, Clean Architecture).
- Keep Controllers/API Endpoints thin; delegate business logic to Service layers.
- Models/Entities should represent data structures. Business logic should reside in services or domain objects.
- Avoid placing significant logic directly in ASP.NET Views (Razor) or UI components.
- Organize projects into logical layers (e.g., `ProjectName.Api`, `ProjectName.Application`, `ProjectName.Domain`, `ProjectName.Infrastructure`, `ProjectName.Data`).
- Use `#region` directives to group related members (e.g., fields, properties, constructors, methods) within a class, especially in larger files.
- Use `using` directives at the top of files to import necessary namespaces, avoiding fully qualified names in code where possible.

### 3.2 Method Guidelines

All public methods should have XML documentation:

```csharp
/// <summary>
/// Calculates the total price including tax.
/// </summary>
/// <param name="price">The base price before tax</param>
/// <param name="taxRate">The tax rate as a decimal (e.g., 0.08 for 8%)</param>
/// <returns>The total price including tax</returns>
public decimal CalculateTotal(decimal price, decimal taxRate)
{
    return price * (1 + taxRate);
}
```

- Use descriptive names: `GetUserDataAsync()` over `GetData()`
- Use appropriate access modifiers (public, private, protected, internal)
- Use async/await for I/O operations
- Avoid excessive parameters (suggested max: 4); consider parameter objects for complex methods

### 3.3 Formatting & Style

- Follow `.editorconfig` for consistent formatting if present in the project.
- Indent with 4 spaces (common C# standard).
- Use UTF-8 encoding for all source files.
- Use Allman style braces (braces on new lines) for classes, methods, and control structures.
- Include a single space after commas and around operators (e.g., `var x = y + z;`).
- Limit line length to a reasonable maximum (e.g., 120 characters) for better readability.

### 3.4 Error Handling

- Use `try-catch` blocks for specific exception handling rather than generic `Exception`.
- Log exceptions with sufficient detail (stack trace, context) using the established logging mechanism.
- Provide user-friendly error messages when appropriate, avoiding exposure of sensitive system details.
- Use `finally` blocks to release resources (e.g., database connections, file streams) if not using `using` statements.

### 3.5 .NET Core Dependency Injection (Applies only to .NET Core Projects/Files)

- Register services in `Program.cs` or `Startup.cs`
- Use constructor injection for required dependencies
- Use appropriate service lifetimes (Singleton, Scoped, Transient)

```csharp
public class UserController : ControllerBase
{
    private readonly IUserService _userService;
    private readonly ILogger<UserController> _logger;

    public UserController(IUserService userService, ILogger<UserController> logger)
    {
        _userService = userService;
        _logger = logger;
    }
}
```

## 4. Database Access Best Practices

**ServiceManager uses ServiceCentral.AppSupport for ALL database operations.** Do not use Entity Framework Core or Entity Framework 6.

#### AppSupport Classes
- **BaseAppSupport**: Abstract base class - use for method parameters that accept an AppSupport instance
- **ServiceAppSupport**: For services/APIs with service account database access (like SCTAPI, SCSchedulingService)
- **WebUserAppSupport**: For applications requiring employee user authentication (like ServiceManager web portals)

#### Entity CRUD Operations
Use the Entity classes from `ServiceCentral.AppSupport` for all database operations:

**EntityRead - Reading Data:**
```csharp
// Modern pattern (use this for new code)
EntityRead oRead = new EntityRead("WorkOrder")
    .Where(new SimpleConstraint("StatusID", "=", "1"))
    .Fields("ID", "WOCode", "StatusDescription")
    .OrderBy("CreateTimestamp", "DESC");

if (oRead.Read(oAppSupport) && oRead.HasRows)
{
    for (int i = 0; i < oRead.RowsReturned; i++)
    {
        string sWorkOrderID = oRead.DBXMLString(i, "ID");
        string sWOCode = oRead.DBXMLString(i, "WOCode");
        string sStatus = oRead.DBXMLString(i, "StatusDescription");
    }
}
```

**EntityCreate - Creating Records:**
```csharp
EntityCreate oCreate = new EntityCreate("WorkOrder")
    .Set("WOCode", sNewWOCode)
    .Set("StatusID", "1")
    .Set("ProgramID", sProgramID)
    .Set("CustomerID", sCustomerID);

if (oCreate.Create(oAppSupport))
{
    string sNewWorkOrderID = oCreate.NewRecordID;
}
```

**EntityUpdate - Updating Records:**
```csharp
EntityUpdate oUpdate = new EntityUpdate("WorkOrder")
    .SetID(sWorkOrderID)
    .Set("StatusID", sNewStatusID)
    .Set("CompleteTimestamp", DateTime.Now);

if (oUpdate.Update(oAppSupport))
{
    // Update successful
}
```

**EntityDelete - Deleting Records:**
```csharp
EntityDelete oDelete = new EntityDelete("WorkOrder")
    .SetID(sWorkOrderID);

if (oDelete.Delete(oAppSupport))
{
    // Delete successful
}
```

## 5. Security Best Practices

- **Input Validation**: Validate and sanitize all external input
- **Output Encoding**: Encode output appropriately for the context (HTML, JavaScript, SQL, URLs)
- **HTTPS**: Use HTTPS for all environments
- **Secrets Management**: Do not commit secrets or credentials to the codebase
- **Authentication & Authorization**: Implement robust authentication and authorization
- **OWASP Top 10 Protection**: Protect against common web vulnerabilities
- **Dependencies**: Keep dependencies up-to-date and scan for vulnerabilities
- **Logging & Monitoring**: Implement proper logging and monitoring

```csharp
// Example: Input validation with Data Annotations
public class UserModel
{
    [Required]
    [StringLength(100)]
    public string Name { get; set; }
    
    [EmailAddress]
    public string Email { get; set; }
}
```

## 6. Logging and Error Handling

- Use ILogger for all logging needs
- Log appropriate levels (Trace, Debug, Information, Warning, Error, Critical)
- Use structured logging with message templates

```csharp
_logger.LogInformation("User {UserId} accessed {Resource} at {Timestamp}", 
    userId, resourceName, DateTime.UtcNow);

try
{
    // risky operation
}
catch (SpecificException ex)
{
    _logger.LogError(ex, "Failed to process user {UserId}", userId);
    throw; // Re-throw if appropriate
}
```

## 7. Configuration Management

- Use appsettings.json for .NET Core configuration
- Use the Options pattern for configuration binding
- Never commit secrets; use environment variables or secure configuration management

```csharp
// Options Pattern
public class DatabaseOptions
{
    public string ConnectionString { get; set; }
    public int TimeoutSeconds { get; set; }
}

// In Program.cs
builder.Services.Configure<DatabaseOptions>(
    builder.Configuration.GetSection("Database"));
```

## 8. Version Control (Git)

### 8.1 Commits
- Write clear, concise, and descriptive commit messages
- Commit small, logical, and atomic changes
- Reference ticket numbers in commit messages

### 8.2 Branching
- Follow the established branching strategy
- Create feature branches from `main`
- Keep branches short-lived and merge back regularly
- Always name branches for the current ticket (e.g., `SCCORE-123`)

### 8.3 Pull Requests
- Write clear PR descriptions
- Address review comments promptly
- Ensure automated checks/tests pass before merging

## 9. Testing Best Practices

- Write unit tests for business logic
- Use dependency injection for testability
- Mock external dependencies
- Follow AAA pattern (Arrange, Act, Assert)
- Prefer NUnit as the testing framework

```csharp
[Test]
public async Task CalculateTotal_WithValidInputs_ReturnsCorrectTotal()
{
    // Arrange
    var service = new PriceCalculationService();
    var price = 100m;
    var taxRate = 0.08m;

    // Act
    var result = service.CalculateTotal(price, taxRate);

    // Assert
    Assert.AreEqual(108m, result);
}
```

## 10. Naming Conventions

### 10.1 C# Naming Conventions

- **Variable Naming with Type Prefixes**: It's a common practice in this codebase to use a prefix denoting the data type, followed by a PascalCase variable name:
  - Local variables: `string sUserName;`, `int iCounter;`, `WebUserAppSupport oAppSupport;`, `List<string> lItems;`, `DateTime dtStartDate;`, `bool bIsValid;`
  - This convention enhances immediate type recognition. `var` may be used sparingly if the type is unequivocally obvious from the right-hand side of the assignment and it doesn't detract from this clarity.
- When in doubt, look for examples in existing code for consistency.

## References

- [.NET Documentation](https://docs.microsoft.com/en-us/dotnet/)
- [ASP.NET Core Documentation](https://docs.microsoft.com/en-us/aspnet/core/)
- [SOLID Principles in C#](https://www.digitalocean.com/community/conceptual_articles/s-o-l-i-d-the-first-5-principles-of-object-oriented-design)

### Code Review Process
When performing a code review, refer to the `templates&#x2F;core&#x2F;copilot-review-instructions.md.mustache` guide.

### Testing Approach
# .NET Testing Guide

## Overview

This document outlines testing standards and practices for .NET applications, covering unit testing, integration testing, and end-to-end testing with modern .NET frameworks.

## Testing Framework Standards

### Primary Testing Stack
- **NUnit** for all .NET test projects (preferred framework)
- **MSTest** acceptable for legacy compatibility where needed
- **Moq** or **NSubstitute** for mocking and test doubles
- **FluentAssertions** for readable assertions
- **AutoFixture** for test data generation

### Test Organization
```
tests/
├── UnitTests/
│   ├── Domain.Tests/
│   ├── Application.Tests/
│   ├── Infrastructure.Tests/
│   └── API.Tests/
├── IntegrationTests/
│   ├── Database.IntegrationTests/
│   ├── API.IntegrationTests/
│   └── Services.IntegrationTests/
└── EndToEndTests/
    └── Playwright/
```

## Writing Quality Tests

### Test Structure
- **Arrange, Act, Assert (AAA) pattern** for all unit tests
- **One assertion per test method** when possible
- **Descriptive test names** that explain the scenario and expected outcome
- **Test both happy path and edge cases**
- **Mock external dependencies** (databases, web services, file system)

### Example Unit Test Structure
```csharp
[Test]
public void CalculateTotal_WithValidInputs_ReturnsCorrectTotal()
{
    // Arrange
    var calculator = new PriceCalculator();
    var price = 100m;
    var taxRate = 0.08m;

    // Act
    var result = calculator.CalculateTotal(price, taxRate);

    // Assert
    result.Should().Be(108m);
}
```

### Test Naming Conventions
```csharp
// Pattern: MethodName_Scenario_ExpectedBehavior
[Test]
public void GetUser_WithValidId_ReturnsUser() { }

[Test]
public void GetUser_WithInvalidId_ThrowsNotFoundException() { }

[Test]
public void ValidateEmail_WithInvalidFormat_ReturnsFalse() { }
```

## Running Tests

### .NET CLI Commands
```bash
# Run all tests in solution
dotnet test

# Run tests in specific project
dotnet test tests/UnitTests/

# Run tests with specific filter
dotnet test --filter "Category=Unit"

# Run tests with code coverage
dotnet test --collect:"XPlat Code Coverage"

# Run tests with detailed output
dotnet test --verbosity detailed

# Run specific test method
dotnet test --filter "FullyQualifiedName~CalculateTotal"
```

### Visual Studio Test Explorer
- Use Test Explorer for interactive test running and debugging
- Organize tests by project, namespace, or category
- Use Live Unit Testing for continuous test feedback
- Configure test settings in `.runsettings` file

### .NET Framework 4.8 Command Line Testing
For .NET Framework 4.8 projects with NUnit, `dotnet test` is not compatible. Use **VSTest.Console.exe** instead:

```bash
# Direct VSTest Console execution
"/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/Extensions/TestPlatform/vstest.console.exe" bin/Debug/YourTestProject.dll

# With custom alias (recommended setup)
vstest bin/Debug/YourTestProject.dll
```

#### Setting Up VSTest Alias
Add to your bash profile (`.bashrc` or `.bash_profile`):

```bash
alias vstest='"/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/Extensions/TestPlatform/vstest.console.exe"'
```

#### Key Points for .NET Framework 4.8 Testing
- ✅ **Visual Studio Test Explorer** and **VSTest Console** use the same discovery engine
- ❌ **dotnet CLI** uses different discovery mechanism that doesn't work with .NET Framework 4.8
- ✅ **VSTest Console** is the proper command-line tool for .NET Framework projects
- ✅ **NUnit 3.13.3** + **NUnit3TestAdapter 4.5.0** = Optimal compatibility

#### Working Project Structure
```
YourTestProject/
├── packages/                    # NuGet packages
├── packages.config              # Package definitions
├── YourProject.Tests.sln
└── YourTestProject/
    ├── YourTestProject.csproj
    └── Tests/
        └── YourTests.cs
```

## Test Categories and Attributes

### Test Categories
```csharp
[Test]
[Category("Unit")]
[Category("UserService")]
public void SomeUnitTest() { }

[Test]
[Category("Integration")]
[Category("Database")]
public void SomeIntegrationTest() { }

[Test]
[TestCase(1, "John")]
[TestCase(2, "Jane")]
public void GetUser_WithValidData_ReturnsExpectedUser(int id, string expectedName) { }
```

### Skip Tests
```csharp
[Test]
[Ignore("Temporarily disabled due to external dependency")]
public void SkippedTest() { }
```

## Unit Testing Best Practices

### Dependency Injection in Tests
```csharp
public class UserServiceTests
{
    private readonly Mock<IUserRepository> _mockRepository;
    private readonly Mock<ILogger<UserService>> _mockLogger;
    private readonly UserService _userService;

    public UserServiceTests()
    {
        _mockRepository = new Mock<IUserRepository>();
        _mockLogger = new Mock<ILogger<UserService>>();
        _userService = new UserService(_mockRepository.Object, _mockLogger.Object);
    }

    [Test]
    public async Task GetUserAsync_WithValidId_ReturnsUser()
    {
        // Arrange
        var userId = 1;
        var expectedUser = new User { Id = userId, Name = "John Doe" };
        _mockRepository.Setup(r => r.GetByIdAsync(userId))
                      .ReturnsAsync(expectedUser);

        // Act
        var result = await _userService.GetUserAsync(userId);

        // Assert
        result.Should().BeEquivalentTo(expectedUser);
        _mockRepository.Verify(r => r.GetByIdAsync(userId), Times.Once);
    }
}
```

### Testing Async Methods
```csharp
[Test]
public async Task ProcessDataAsync_WithValidData_CompletesSuccessfully()
{
    // Arrange
    var data = new List<string> { "item1", "item2" };
    
    // Act
    var result = await _service.ProcessDataAsync(data);
    
    // Assert
    result.Should().BeTrue();
}
```

### Testing Exceptions
```csharp
[Test]
public void ValidateUser_WithNullUser_ThrowsArgumentNullException()
{
    // Arrange
    User user = null;

    // Act & Assert
    var exception = Assert.Throws<ArgumentNullException>(() => _service.ValidateUser(user));
    exception.ParamName.Should().Be("user");
}

[Test]
public async Task GetUserAsync_WithInvalidId_ThrowsNotFoundException()
{
    // Arrange
    var invalidId = -1;
    _mockRepository.Setup(r => r.GetByIdAsync(invalidId))
                   .ThrowsAsync(new NotFoundException("User not found"));

    // Act & Assert
    var ex = await Assert.ThrowsAsync<NotFoundException>(() => _userService.GetUserAsync(invalidId));
    ex.Message.Should().Contain("User not found");
}
```

## Integration Testing

### Database Integration Tests
```csharp
public class UserRepositoryIntegrationTests : IClassFixture<DatabaseFixture>
{
    private readonly DatabaseFixture _fixture;

    public UserRepositoryIntegrationTests(DatabaseFixture fixture)
    {
        _fixture = fixture;
    }

    [Test]
    public async Task SaveUser_WithValidUser_SavesSuccessfully()
    {
        // Arrange
        using var context = _fixture.CreateContext();
        var repository = new UserRepository(context);
        var user = new User { Name = "Test User", Email = "test@example.com" };

        // Act
        await repository.SaveAsync(user);

        // Assert
        var savedUser = await repository.GetByIdAsync(user.Id);
        savedUser.Should().NotBeNull();
        savedUser.Name.Should().Be("Test User");
    }
}

public class DatabaseFixture : IDisposable
{
    private readonly string _connectionString;

    public DatabaseFixture()
    {
        _connectionString = "Server=(localdb)\\mssqllocaldb;Database=TestDb;Trusted_Connection=true;";
        // Setup test database
    }

    public ApplicationDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseSqlServer(_connectionString)
            .Options;
        return new ApplicationDbContext(options);
    }

    public void Dispose()
    {
        // Cleanup test database
    }
}
```

### API Integration Tests
```csharp
public class UsersControllerIntegrationTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public UsersControllerIntegrationTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
        _client = _factory.CreateClient();
    }

    [Test]
    public async Task GetUsers_ReturnsSuccessStatusCode()
    {
        // Act
        var response = await _client.GetAsync("/api/users");

        // Assert
        response.EnsureSuccessStatusCode();
        var content = await response.Content.ReadAsStringAsync();
        content.Should().NotBeEmpty();
    }
}
```

## End-to-End Testing

### Playwright Setup
```csharp
[TestClass]
public class LoginTests
{
    private IBrowser? _browser;
    private IPage? _page;

    [TestInitialize]
    public async Task Setup()
    {
        var playwright = await Playwright.CreateAsync();
        _browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions { Headless = false });
        _page = await _browser.NewPageAsync();
    }

    [TestMethod]
    public async Task Login_WithValidCredentials_RedirectsToDashboard()
    {
        // Arrange
        await _page.GotoAsync("https://localhost:5001/login");

        // Act
        await _page.FillAsync("#email", "test@example.com");
        await _page.FillAsync("#password", "password123");
        await _page.ClickAsync("#login-button");

        // Assert
        await _page.WaitForURLAsync("**/dashboard");
        var title = await _page.TitleAsync();
        Assert.AreEqual("Dashboard", title);
    }

    [TestCleanup]
    public async Task Cleanup()
    {
        await _browser?.CloseAsync();
    }
}
```

## Test Configuration

### .runsettings File
```xml
<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat code coverage" uri="datacollector://Microsoft/CodeCoverage/2.0" assemblyQualifiedName="Microsoft.CodeCoverage.CoreLib.CodeCoverageDataCollector, Microsoft.CodeCoverage.CoreLib" enabled="True">
        <Configuration>
          <Format>json,cobertura,lcov,teamcity,opencover</Format>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

### Test Project Configuration
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <IsPackable>false</IsPackable>
    <IsTestProject>true</IsTestProject>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="NUnit" Version="3.13.3" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.5.0" />
    <PackageReference Include="Moq" Version="4.20.69" />
    <PackageReference Include="FluentAssertions" Version="6.12.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.7.1" />
    <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="8.0.0" />
  </ItemGroup>
</Project>
```

## Best Practices Summary

1. **Write tests first** or alongside code development (TDD/BDD)
2. **Keep tests simple** and focused on single behaviors
3. **Use descriptive test names** that explain the scenario
4. **Mock external dependencies** to isolate units under test
5. **Test edge cases** and error conditions
6. **Maintain test code quality** as production code
7. **Run tests frequently** during development
8. **Aim for high code coverage** but focus on meaningful tests
10. **Review and refactor tests** regularly


## Documentation & Knowledge Management

### Internal Documentation
- **Location**: `_ai/docs/` directory contains project-specific documentation
- **Maintenance**: Update documentation as you learn about the system
- **Guide**: Use `.service-central-copilot/docs/workflows/documentation_guide.md` for documentation standards

### Memory System
- **Purpose**: Store important findings and context across sessions
- **Usage**: Always check memory before investigating new areas
- **Guide**: Follow `.service-central-copilot/.service-central-copilot/.service-central-copilot/docs/system/ai_memory_management.md` for memory management practices

