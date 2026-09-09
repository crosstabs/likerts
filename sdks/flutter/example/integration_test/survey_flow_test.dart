import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:likerts_example/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('respondent completes the embedded survey', (tester) async {
    app.main();
    await tester.pumpAndSettle();
    final page = find.byType(Scrollable).first;

    await tester.scrollUntilVisible(find.text('Send feedback'), 300, scrollable: page);
    await tester.tap(find.text('Send feedback'));
    await tester.pumpAndSettle();
    expect(find.text('How satisfied are you?: an answer is required.'), findsOneWidget);

    await tester.scrollUntilVisible(find.text('5 — Very satisfied'), -300, scrollable: page);
    await tester.tap(find.text('5 — Very satisfied'));
    await tester.enterText(find.byType(EditableText), 'Faster checkout');
    await tester.scrollUntilVisible(find.text('Yes'), 300, scrollable: page);
    await tester.tap(find.text('Yes'));
    await tester.scrollUntilVisible(find.text('Send feedback'), 300, scrollable: page);
    await tester.tap(find.text('Send feedback'));
    await tester.pumpAndSettle();

    expect(find.text('Thank you for your feedback.'), findsOneWidget);
  });
}
